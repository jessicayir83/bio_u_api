import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { BlockedIpEntity } from './entities/blocked-ip.entity';
import { BlockIpDto } from './dto/block-ip.dto';
import { AuditService } from '../audit/audit.service';
import { BLOCKABLE_ALERT_TYPES } from '../audit/audit.constants';
import { isLoopbackIp, isValidIp, normalizeIp } from './ip-address.util';

interface ActingUser {
  userId: number;
  username: string;
  roles: string[];
}

export interface ActiveBlock {
  id: number;
  expiresAt: Date | null;
}

/** Se relee la tabla cada tanto por si otro proceso (u otro Admin vía SQL) cambió los bloqueos. */
const CACHE_REFRESH_MS = 60_000;
const HISTORY_LIMIT = 50;

@Injectable()
export class IpBlockService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IpBlockService.name);
  /** Bloqueos activos en memoria: el middleware consulta esto en cada request, sin ir a la base. */
  private activeBlocks = new Map<string, ActiveBlock>();
  private refreshTimer?: NodeJS.Timeout;
  private storageWarningLogged = false;

  constructor(
    @InjectRepository(BlockedIpEntity)
    private readonly blockedIpRepository: Repository<BlockedIpEntity>,
    private readonly auditService: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refreshCache();
    this.refreshTimer = setInterval(() => void this.refreshCache(), CACHE_REFRESH_MS);
    this.refreshTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  /** Bloqueo activo (y no vencido) para la IP, o null. */
  findActiveBlock(rawIp: string | null | undefined): ActiveBlock | null {
    const ip = normalizeIp(rawIp);
    if (!ip) return null;
    const block = this.activeBlocks.get(ip);
    if (!block) return null;
    if (block.expiresAt && block.expiresAt.getTime() <= Date.now()) return null;
    return block;
  }

  async list() {
    const rows = await this.blockedIpRepository.find({ order: { blockedAt: 'DESC' }, take: HISTORY_LIMIT });
    return rows.map((row) => this.toDto(row));
  }

  async block(dto: BlockIpDto, user: ActingUser, requesterIp: string | null) {
    const alert = await this.auditService.findEvent(dto.sourceAuditEventId);
    if (!BLOCKABLE_ALERT_TYPES.has(alert.eventType)) {
      throw new BadRequestException(
        'Desde esta alerta no se puede bloquear la IP: solo desde alertas de intentos fallidos o alarmantes.',
      );
    }

    const ip = normalizeIp(alert.sourceIp);
    if (!ip || !isValidIp(ip)) {
      throw new BadRequestException('La alerta no tiene una IP válida para bloquear.');
    }
    if (isLoopbackIp(ip)) {
      throw new BadRequestException('No se puede bloquear una IP local (127.0.0.1 / ::1): dejaría sin acceso al propio servidor.');
    }
    if (ip === normalizeIp(requesterIp)) {
      throw new BadRequestException('No podés bloquear tu propia IP: te quedarías sin acceso al panel.');
    }

    const current = await this.blockedIpRepository.findOne({ where: { ipAddress: ip, unblockedAt: IsNull() } });
    if (current) {
      if (!current.expiresAt || current.expiresAt.getTime() > Date.now()) {
        throw new ConflictException(`La IP ${ip} ya está bloqueada.`);
      }
      // Bloqueo vencido que seguía "abierto": se cierra para permitir uno nuevo (índice único filtrado).
      current.unblockedAt = current.expiresAt;
      current.unblockedByUsername = 'sistema';
      current.unblockReason = 'Venció el plazo del bloqueo';
      await this.blockedIpRepository.save(current);
    }

    const now = new Date();
    const saved = await this.blockedIpRepository.save(
      this.blockedIpRepository.create({
        ipAddress: ip,
        reason: dto.reason.trim(),
        sourceAuditEventId: alert.id,
        sourceEventType: alert.eventType,
        blockedByUserId: user.userId,
        blockedByUsername: user.username,
        blockedAt: now,
        expiresAt: dto.durationHours ? new Date(now.getTime() + dto.durationHours * 3600_000) : null,
      }),
    );
    await this.refreshCache();

    // Bloquear implica que la alerta fue revisada.
    if (!alert.acknowledgement) {
      try {
        await this.auditService.acknowledge(alert.id, user, `IP bloqueada: ${dto.reason.trim()}`.slice(0, 500));
      } catch (err) {
        if (!(err instanceof ConflictException)) throw err;
      }
    }

    // Después de acknowledge: la anotación del request debe quedar como SECURITY_IP_BLOCKED.
    this.auditService.annotate({
      eventType: 'SECURITY_IP_BLOCKED',
      targetType: 'BlockedIp',
      targetId: saved.id,
      message: `IP ${ip} bloqueada ${dto.durationHours ? `por ${dto.durationHours} h` : 'sin vencimiento'}`,
      details: {
        ipAddress: ip,
        durationHours: dto.durationHours ?? null,
        sourceAuditEventId: alert.id,
        sourceEventType: alert.eventType,
      },
    });

    return this.toDto(saved);
  }

  async unblock(id: number, user: ActingUser, reason?: string) {
    const row = await this.blockedIpRepository.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException(`No existe el bloqueo ${id}.`);
    }
    if (row.unblockedAt) {
      throw new ConflictException('Ese bloqueo ya estaba levantado.');
    }

    row.unblockedAt = new Date();
    row.unblockedByUserId = user.userId;
    row.unblockedByUsername = user.username;
    row.unblockReason = reason?.trim() || null;
    const saved = await this.blockedIpRepository.save(row);
    await this.refreshCache();

    this.auditService.annotate({
      eventType: 'SECURITY_IP_UNBLOCKED',
      targetType: 'BlockedIp',
      targetId: id,
      message: `IP ${row.ipAddress} desbloqueada`,
      details: { ipAddress: row.ipAddress, hadExpired: !!row.expiresAt && row.expiresAt.getTime() <= Date.now() },
    });

    return this.toDto(saved);
  }

  private async refreshCache(): Promise<void> {
    try {
      const rows = await this.blockedIpRepository.find({ where: { unblockedAt: IsNull() } });
      this.activeBlocks = new Map(rows.map((row) => [row.ipAddress, { id: row.id, expiresAt: row.expiresAt }]));
      this.storageWarningLogged = false;
    } catch (err) {
      if (!this.storageWarningLogged) {
        this.storageWarningLogged = true;
        this.logger.warn(
          `No se pudo leer security.BlockedIp (${err instanceof Error ? err.message : String(err)}). ` +
            '¿Se ejecutó bio_u_db/07_create_blocked_ip_table.sql? Mientras tanto no hay IPs bloqueadas.',
        );
      }
    }
  }

  private toDto(row: BlockedIpEntity) {
    const expired = !!row.expiresAt && row.expiresAt.getTime() <= Date.now();
    return {
      id: row.id,
      ipAddress: row.ipAddress,
      reason: row.reason,
      sourceAuditEventId: row.sourceAuditEventId === null ? null : String(row.sourceAuditEventId),
      sourceEventType: row.sourceEventType,
      blockedBy: row.blockedByUsername,
      blockedAt: row.blockedAt,
      expiresAt: row.expiresAt,
      unblockedAt: row.unblockedAt,
      unblockedBy: row.unblockedByUsername,
      unblockReason: row.unblockReason,
      status: row.unblockedAt ? 'UNBLOCKED' : expired ? 'EXPIRED' : 'ACTIVE',
    };
  }
}
