import {
  BadRequestException,
  BeforeApplicationShutdown,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import type { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { AppConfig } from '../../config/configuration';
import { AuditEventEntity } from './entities/audit-event.entity';
import { AlertAcknowledgementEntity } from './entities/alert-acknowledgement.entity';
import {
  AUDIT_EVENT_TYPES,
  BLOCKABLE_ALERT_TYPES,
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  AuditSeverity,
} from './audit.constants';
import { AuditAnnotation, AuditErrorInfo, AuditRequestContext, auditContextStorage } from './audit-context';
import { sanitizeDetails, truncate } from './audit-sanitizer';
import { AuditAnomalyDetector, ObservedAuditEvent } from './audit-anomaly.detector';
import type { AuditEventsQueryDto } from './dto/audit-events-query.dto';

/** Evento completo, listo para escribir. */
export interface AuditRecordInput {
  eventType: AuditEventType;
  severity?: AuditSeverity;
  outcome?: AuditOutcome;
  actorType?: AuditActorType;
  actorUserId?: number | null;
  actorUsername?: string | null;
  sourceIp?: string | null;
  userAgent?: string | null;
  httpMethod?: string | null;
  path?: string | null;
  statusCode?: number | null;
  durationMs?: number | null;
  targetType?: string | null;
  targetId?: string | number | null;
  message?: string | null;
  details?: Record<string, unknown>;
  correlationId?: string | null;
}

interface AuthenticatedRequestUser {
  userId: number;
  username: string;
  roles: string[];
}

/** Lecturas frecuentes que no anotan ningún servicio: se tipifican por ruta. */
const READ_ROUTE_EVENT_TYPES: Array<{ pattern: RegExp; eventType: AuditEventType; targetType?: string }> = [
  { pattern: /^\/persons$/, eventType: 'PERSON_LISTED' },
  { pattern: /^\/persons\/(\d+)(?:\/(?:scans|registrations))?$/, eventType: 'PERSON_VIEWED', targetType: 'Person' },
  { pattern: /^\/users$/, eventType: 'USER_LISTED' },
  { pattern: /^\/users\/(\d+)$/, eventType: 'USER_VIEWED', targetType: 'User' },
  { pattern: /^\/roles$/, eventType: 'ROLE_LISTED' },
  { pattern: /^\/enrollments$/, eventType: 'ENROLLMENT_LISTED' },
  { pattern: /^\/enrollments\/(\d+)$/, eventType: 'ENROLLMENT_VIEWED', targetType: 'Enrollment' },
  { pattern: /^\/health$/, eventType: 'HEALTH_CHECKED' },
  { pattern: /^\/audit\//, eventType: 'AUDIT_VIEWED' },
];

const ALERT_SEVERITIES: AuditSeverity[] = ['SEV1', 'SEV2'];
const EXPORT_MAX_ROWS = 10_000;

@Injectable()
export class AuditService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(AuditService.name);
  private readonly config: AppConfig['audit'];
  private readonly detector: AuditAnomalyDetector;
  private storageWarningLogged = false;

  constructor(
    @InjectRepository(AuditEventEntity)
    private readonly eventRepository: Repository<AuditEventEntity>,
    @InjectRepository(AlertAcknowledgementEntity)
    private readonly acknowledgementRepository: Repository<AlertAcknowledgementEntity>,
    configService: ConfigService,
  ) {
    this.config = configService.get<AppConfig['audit']>('audit')!;
    this.detector = new AuditAnomalyDetector(this.config);
  }

  // ---------------------------------------------------------------------------
  // Escritura
  // ---------------------------------------------------------------------------

  /**
   * Agrega información al evento del request en curso (se escribe al
   * terminar el request, con status y duración). Fuera de un request
   * (ej. tareas de sistema) se escribe en el momento.
   */
  annotate(annotation: AuditAnnotation): void {
    const context = auditContextStorage.getStore();
    if (!context) {
      if (annotation.eventType) {
        void this.record({ ...annotation, eventType: annotation.eventType, actorType: 'SYSTEM' });
      }
      return;
    }
    context.annotation = {
      ...context.annotation,
      ...annotation,
      details: { ...context.annotation.details, ...annotation.details },
    };
  }

  /** IP del request en curso (para reglas que la necesitan antes de terminar, ej. "IP nueva"). */
  currentSourceIp(): string | null {
    return auditContextStorage.getStore()?.sourceIp ?? null;
  }

  /** Lo llama el filtro global de excepciones: guarda el error para el evento del request. */
  captureException(exception: unknown): void {
    const context = auditContextStorage.getStore();
    if (!context) return;
    context.error = this.describeError(exception);
  }

  /** Nunca lanza: una falla de auditoría no puede romper la operación auditada. */
  async record(input: AuditRecordInput, observe = true): Promise<void> {
    const definition = AUDIT_EVENT_TYPES[input.eventType];
    const entity: Partial<AuditEventEntity> = {
      occurredAt: new Date(),
      severity: input.severity ?? definition.severity,
      category: definition.category,
      eventType: input.eventType,
      outcome: input.outcome ?? definition.outcome,
      actorType: input.actorType ?? (input.actorUserId ? 'USER' : 'ANONYMOUS'),
      actorUserId: input.actorUserId ?? null,
      actorUsername: truncate(input.actorUsername, 100),
      sourceIp: truncate(input.sourceIp, 64),
      userAgent: truncate(input.userAgent, 400),
      httpMethod: truncate(input.httpMethod, 10),
      path: truncate(input.path, 400),
      statusCode: input.statusCode ?? null,
      durationMs: input.durationMs ?? null,
      targetType: truncate(input.targetType, 40),
      targetId: input.targetId === null || input.targetId === undefined ? null : truncate(String(input.targetId), 64),
      message: truncate(input.message ?? definition.label, 1000),
      details: sanitizeDetails(input.details),
      correlationId: truncate(input.correlationId, 64),
    };

    try {
      await this.eventRepository.insert(entity);
    } catch (err) {
      await this.writeFallback(entity, err);
    }

    if (!observe) return;
    const alerts = this.detector.observe(entity as ObservedAuditEvent);
    for (const alert of alerts) {
      this.logger.warn(`Alerta ${AUDIT_EVENT_TYPES[alert.eventType].severity} ${alert.eventType} (IP ${alert.sourceIp})`);
      await this.record(
        {
          eventType: alert.eventType,
          actorType: 'SYSTEM',
          actorUsername: alert.actorUsername,
          sourceIp: alert.sourceIp,
          correlationId: alert.correlationId,
          details: alert.details,
        },
        false,
      );
    }
  }

  /** Arma y escribe el evento de un request HTTP terminado (lo llama el middleware). */
  async recordHttp(context: AuditRequestContext, req: Request, res: Response): Promise<void> {
    const method = req.method;
    const [rawPath, rawQuery] = (req.originalUrl ?? req.url).split('?');
    const status = res.statusCode;
    const user = (req as Request & { user?: AuthenticatedRequestUser }).user;
    const { annotation, error } = context;

    let eventType: AuditEventType = annotation.eventType ?? 'HTTP_REQUEST';
    let targetType = annotation.targetType;
    let targetId = annotation.targetId;
    const details: Record<string, unknown> = { ...annotation.details };

    // Un error del servidor manda sobre lo anotado (que pudo quedar a medias).
    if (status >= 500 || (error && error.status >= 500)) {
      if (annotation.eventType) details.annotatedEventType = annotation.eventType;
      eventType = this.serverErrorEventType(error);
    } else if (!annotation.eventType) {
      if (status === 429) eventType = 'SECURITY_RATE_LIMITED';
      else if (status === 404) eventType = 'HTTP_NOT_FOUND';
      else if (status >= 400) eventType = 'HTTP_CLIENT_ERROR';
      else if (method === 'GET') {
        const route = READ_ROUTE_EVENT_TYPES.find((candidate) => candidate.pattern.test(rawPath));
        if (route) {
          eventType = route.eventType;
          const idMatch = route.targetType ? route.pattern.exec(rawPath) : null;
          if (idMatch?.[1]) {
            targetType = route.targetType;
            targetId = idMatch[1];
          }
        }
      }
    }

    if (rawQuery) {
      // Solo las claves: los valores (ej. una búsqueda por cédula) pueden ser datos personales.
      details.queryKeys = [...new URLSearchParams(rawQuery).keys()];
    }
    if (error) details.error = { name: error.name, message: error.message };
    if (!res.writableFinished) details.aborted = true;

    const definition = AUDIT_EVENT_TYPES[eventType];
    const message =
      annotation.message ?? (error && !annotation.eventType ? `${definition.label}: ${error.message}` : definition.label);

    const isAuthenticated = !!user;
    await this.record({
      eventType,
      severity: eventType === annotation.eventType ? annotation.severity : undefined,
      outcome:
        eventType === annotation.eventType ? annotation.outcome : eventType === 'HTTP_REQUEST' && status >= 400 ? 'FAILURE' : undefined,
      actorType: isAuthenticated || annotation.actorUserId ? 'USER' : 'ANONYMOUS',
      actorUserId: user?.userId ?? annotation.actorUserId ?? null,
      actorUsername: user?.username ?? annotation.actorUsername ?? null,
      sourceIp: context.sourceIp,
      userAgent: context.userAgent,
      httpMethod: method,
      path: rawPath,
      statusCode: status,
      durationMs: Date.now() - context.startedAt,
      targetType,
      targetId,
      message,
      details,
      correlationId: context.correlationId,
    });
  }

  async recordSystemStartup(details: Record<string, unknown>): Promise<void> {
    await this.record({ eventType: 'SYSTEM_STARTUP', actorType: 'SYSTEM', details });
  }

  /** Solo con señal del proceso (Ctrl+C, reinicio del watch): un app.close() de un script no cuenta como apagado del API. */
  async beforeApplicationShutdown(signal?: string): Promise<void> {
    this.detector.dispose();
    if (signal) {
      await this.record({ eventType: 'SYSTEM_SHUTDOWN', actorType: 'SYSTEM', details: { signal } }, false);
    }
  }

  /** Historial de inicios de sesión de la cuenta: ¿alguno previo?, ¿alguno desde esta IP? */
  async loginHistory(userId: number, sourceIp: string | null): Promise<{ hasPreviousLogins: boolean; hasLoginFromIp: boolean }> {
    try {
      const base = () =>
        this.eventRepository
          .createQueryBuilder('e')
          .where('e.actorUserId = :userId', { userId })
          .andWhere('e.eventType IN (:...types)', { types: ['AUTH_LOGIN_SUCCESS', 'AUTH_LOGIN_NEW_IP'] });
      const hasPreviousLogins = (await base().getCount()) > 0;
      const hasLoginFromIp = hasPreviousLogins && sourceIp ? (await base().andWhere('e.sourceIp = :ip', { ip: sourceIp }).getCount()) > 0 : false;
      return { hasPreviousLogins, hasLoginFromIp };
    } catch {
      // Sin tabla de auditoría (script 06 sin ejecutar) no hay historial: se trata como primer login.
      return { hasPreviousLogins: false, hasLoginFromIp: false };
    }
  }

  // ---------------------------------------------------------------------------
  // Consulta (dashboard, solo Admin)
  // ---------------------------------------------------------------------------

  async findEvents(query: AuditEventsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const qb = this.applyFilters(this.eventRepository.createQueryBuilder('e'), query)
      .orderBy('e.occurredAt', 'DESC')
      .addOrderBy('e.id', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [items, total] = await qb.getManyAndCount();
    const acknowledgements = await this.acknowledgementsFor(items.map((item) => item.id));
    return {
      items: items.map((item) => this.toDto(item, acknowledgements.get(item.id))),
      total,
      page,
      pageSize,
    };
  }

  async findEvent(id: string) {
    const event = await this.eventRepository.findOne({ where: { id } });
    if (!event) {
      throw new NotFoundException(`No existe el evento de auditoría ${id}.`);
    }
    const acknowledgements = await this.acknowledgementsFor([event.id]);
    // Eventos del mismo request (ej. la alerta y el request que la disparó).
    const related = event.correlationId
      ? await this.eventRepository.find({
          where: { correlationId: event.correlationId },
          order: { occurredAt: 'ASC' },
          take: 20,
        })
      : [];
    return {
      ...this.toDto(event, acknowledgements.get(event.id)),
      related: related.filter((item) => item.id !== event.id).map((item) => this.toDto(item)),
    };
  }

  async summary(from: Date, to: Date) {
    const params = [from, to];
    const range = 'OccurredAt >= @0 AND OccurredAt < @1';

    const [bySeverity, timeline, topIps, topEventTypes, openAlerts, openAlertCount] = await Promise.all([
      this.eventRepository.query(`SELECT Severity AS severity, COUNT(*) AS total FROM audit.AuditEvent WHERE ${range} GROUP BY Severity`, params),
      this.eventRepository.query(
        `SELECT DATEADD(HOUR, DATEDIFF(HOUR, 0, OccurredAt), 0) AS bucket, Severity AS severity, COUNT(*) AS total
         FROM audit.AuditEvent WHERE ${range}
         GROUP BY DATEADD(HOUR, DATEDIFF(HOUR, 0, OccurredAt), 0), Severity
         ORDER BY bucket`,
        params,
      ),
      this.eventRepository.query(
        `SELECT TOP 10 SourceIp AS sourceIp, COUNT(*) AS total,
           SUM(CASE WHEN Severity = 'SEV1' THEN 1 ELSE 0 END) AS sev1,
           SUM(CASE WHEN Severity = 'SEV2' THEN 1 ELSE 0 END) AS sev2,
           SUM(CASE WHEN Severity = 'SEV3' THEN 1 ELSE 0 END) AS sev3,
           MAX(OccurredAt) AS lastSeen
         FROM audit.AuditEvent WHERE ${range} AND SourceIp IS NOT NULL
         GROUP BY SourceIp
         ORDER BY sev1 DESC, sev2 DESC, sev3 DESC, total DESC`,
        params,
      ),
      this.eventRepository.query(
        `SELECT TOP 10 EventType AS eventType, Severity AS severity, COUNT(*) AS total
         FROM audit.AuditEvent WHERE ${range} AND Severity <> 'NORMAL'
         GROUP BY EventType, Severity
         ORDER BY CASE Severity WHEN 'SEV1' THEN 1 WHEN 'SEV2' THEN 2 ELSE 3 END, total DESC`,
        params,
      ),
      this.eventRepository
        .createQueryBuilder('e')
        .where('e.severity IN (:...severities)', { severities: ALERT_SEVERITIES })
        .andWhere('NOT EXISTS (SELECT 1 FROM audit.AlertAcknowledgement a WHERE a.AuditEventId = e.Id)')
        .orderBy('e.severity', 'ASC')
        .addOrderBy('e.occurredAt', 'DESC')
        .take(20)
        .getMany(),
      this.eventRepository
        .createQueryBuilder('e')
        .where('e.severity IN (:...severities)', { severities: ALERT_SEVERITIES })
        .andWhere('NOT EXISTS (SELECT 1 FROM audit.AlertAcknowledgement a WHERE a.AuditEventId = e.Id)')
        .getCount(),
    ]);

    const counts: Record<AuditSeverity, number> = { SEV1: 0, SEV2: 0, SEV3: 0, NORMAL: 0 };
    for (const row of bySeverity as Array<{ severity: AuditSeverity; total: number }>) counts[row.severity] = Number(row.total);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      counts,
      timeline: (timeline as Array<{ bucket: Date; severity: AuditSeverity; total: number }>).map((row) => ({
        bucket: new Date(row.bucket).toISOString(),
        severity: row.severity,
        total: Number(row.total),
      })),
      topIps: (topIps as Array<Record<string, unknown>>).map((row) => ({
        sourceIp: row.sourceIp as string,
        total: Number(row.total),
        sev1: Number(row.sev1),
        sev2: Number(row.sev2),
        sev3: Number(row.sev3),
        lastSeen: new Date(row.lastSeen as Date).toISOString(),
      })),
      topEventTypes: (topEventTypes as Array<{ eventType: string; severity: AuditSeverity; total: number }>).map((row) => ({
        eventType: row.eventType,
        severity: row.severity,
        total: Number(row.total),
        label: AUDIT_EVENT_TYPES[row.eventType as AuditEventType]?.label ?? row.eventType,
      })),
      openAlerts: openAlerts.map((event) => this.toDto(event)),
      openAlertCount,
    };
  }

  catalog() {
    return Object.entries(AUDIT_EVENT_TYPES).map(([eventType, definition]) => ({
      eventType,
      ...definition,
      blockable: BLOCKABLE_ALERT_TYPES.has(eventType),
    }));
  }

  async acknowledge(id: string, user: AuthenticatedRequestUser, note?: string) {
    const event = await this.eventRepository.findOne({ where: { id } });
    if (!event) {
      throw new NotFoundException(`No existe el evento de auditoría ${id}.`);
    }
    if (!ALERT_SEVERITIES.includes(event.severity as AuditSeverity)) {
      throw new BadRequestException('Solo las alertas SEV1 y SEV2 se marcan como revisadas.');
    }
    if (await this.acknowledgementRepository.findOne({ where: { auditEventId: id } })) {
      throw new ConflictException('Esta alerta ya fue marcada como revisada.');
    }

    await this.acknowledgementRepository.insert({
      auditEventId: id,
      acknowledgedByUserId: user.userId,
      acknowledgedByUsername: user.username,
      note: note?.trim() || null,
      acknowledgedAt: new Date(),
    });

    this.annotate({
      eventType: 'AUDIT_ALERT_ACKNOWLEDGED',
      targetType: 'AuditEvent',
      targetId: id,
      details: { alertEventType: event.eventType, alertSeverity: event.severity, hasNote: !!note?.trim() },
    });
    return this.findEvent(id);
  }

  async exportCsv(query: AuditEventsQueryDto): Promise<{ csv: string; rows: number; truncated: boolean }> {
    const rows = await this.applyFilters(this.eventRepository.createQueryBuilder('e'), query)
      .orderBy('e.occurredAt', 'DESC')
      .addOrderBy('e.id', 'DESC')
      .take(EXPORT_MAX_ROWS + 1)
      .getMany();
    const truncated = rows.length > EXPORT_MAX_ROWS;
    const exported = rows.slice(0, EXPORT_MAX_ROWS);

    const columns: Array<keyof AuditEventEntity> = [
      'id', 'occurredAt', 'severity', 'category', 'eventType', 'outcome', 'actorType', 'actorUserId', 'actorUsername',
      'sourceIp', 'httpMethod', 'path', 'statusCode', 'durationMs', 'targetType', 'targetId', 'message', 'details',
      'correlationId', 'userAgent',
    ];
    const lines = [columns.join(',')];
    for (const row of exported) {
      lines.push(columns.map((column) => this.csvCell(row[column])).join(','));
    }

    this.annotate({
      eventType: 'AUDIT_EXPORTED',
      details: { rows: exported.length, truncated, filters: this.describeFilters(query) },
    });
    // BOM para que Excel abra bien los acentos.
    return { csv: `﻿${lines.join('\r\n')}`, rows: exported.length, truncated };
  }

  describeFilters(query: AuditEventsQueryDto): Record<string, unknown> {
    const { page, pageSize, ...filters } = query;
    return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined && value !== ''));
  }

  // ---------------------------------------------------------------------------
  // Internos
  // ---------------------------------------------------------------------------

  private applyFilters(qb: SelectQueryBuilder<AuditEventEntity>, query: AuditEventsQueryDto) {
    if (query.severity?.length) qb.andWhere('e.severity IN (:...severity)', { severity: query.severity });
    if (query.category) qb.andWhere('e.category = :category', { category: query.category });
    if (query.eventType) qb.andWhere('e.eventType = :eventType', { eventType: query.eventType });
    if (query.outcome) qb.andWhere('e.outcome = :outcome', { outcome: query.outcome });
    if (query.sourceIp) qb.andWhere('e.sourceIp = :sourceIp', { sourceIp: query.sourceIp });
    if (query.actor) qb.andWhere("e.actorUsername LIKE :actor ESCAPE '\\'", { actor: `%${this.escapeLike(query.actor)}%` });
    if (query.actorUserId) qb.andWhere('e.actorUserId = :actorUserId', { actorUserId: query.actorUserId });
    if (query.targetType) qb.andWhere('e.targetType = :targetType', { targetType: query.targetType });
    if (query.targetId) qb.andWhere('e.targetId = :targetId', { targetId: query.targetId });
    if (query.correlationId) qb.andWhere('e.correlationId = :correlationId', { correlationId: query.correlationId });
    if (query.from) qb.andWhere('e.occurredAt >= :from', { from: new Date(query.from) });
    if (query.to) qb.andWhere('e.occurredAt < :to', { to: new Date(query.to) });
    if (query.search) {
      qb.andWhere("(e.message LIKE :search ESCAPE '\\' OR e.path LIKE :search ESCAPE '\\' OR e.eventType LIKE :search ESCAPE '\\')", {
        search: `%${this.escapeLike(query.search)}%`,
      });
    }
    if (query.acknowledged !== undefined) {
      const exists = 'EXISTS (SELECT 1 FROM audit.AlertAcknowledgement a WHERE a.AuditEventId = e.Id)';
      qb.andWhere(query.acknowledged ? exists : `NOT ${exists}`);
    }
    return qb;
  }

  private async acknowledgementsFor(ids: string[]): Promise<Map<string, AlertAcknowledgementEntity>> {
    if (ids.length === 0) return new Map();
    const rows = await this.acknowledgementRepository
      .createQueryBuilder('a')
      .where('a.auditEventId IN (:...ids)', { ids })
      .getMany();
    return new Map(rows.map((row) => [String(row.auditEventId), row]));
  }

  private toDto(event: AuditEventEntity, acknowledgement?: AlertAcknowledgementEntity) {
    let details: unknown = null;
    if (event.details) {
      try {
        details = JSON.parse(event.details);
      } catch {
        details = event.details;
      }
    }
    return {
      id: String(event.id),
      occurredAt: event.occurredAt,
      severity: event.severity,
      category: event.category,
      eventType: event.eventType,
      eventLabel: AUDIT_EVENT_TYPES[event.eventType as AuditEventType]?.label ?? event.eventType,
      /** Alerta de intentos fallidos/alarmantes con IP: el dashboard ofrece bloquear esa IP. */
      blockable: BLOCKABLE_ALERT_TYPES.has(event.eventType) && !!event.sourceIp,
      outcome: event.outcome,
      actorType: event.actorType,
      actorUserId: event.actorUserId,
      actorUsername: event.actorUsername,
      sourceIp: event.sourceIp,
      userAgent: event.userAgent,
      httpMethod: event.httpMethod,
      path: event.path,
      statusCode: event.statusCode,
      durationMs: event.durationMs,
      targetType: event.targetType,
      targetId: event.targetId,
      message: event.message,
      details,
      correlationId: event.correlationId,
      acknowledgement: acknowledgement
        ? {
            by: acknowledgement.acknowledgedByUsername,
            at: acknowledgement.acknowledgedAt,
            note: acknowledgement.note,
          }
        : null,
    };
  }

  private describeError(exception: unknown): AuditErrorInfo {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      let message = exception.message;
      if (typeof response === 'object' && response !== null && 'message' in response) {
        const raw = (response as { message: unknown }).message;
        message = Array.isArray(raw) ? raw.join('; ') : String(raw);
      }
      return { status: exception.getStatus(), name: exception.constructor.name, message };
    }
    const error = exception instanceof Error ? exception : new Error(String(exception));
    // SQL Server incluye el valor truncado en algunos errores: puede ser un dato personal.
    const message = error.message.replace(/Truncated value: '.*?'/g, "Truncated value: '[REDACTED]'");
    return { status: 500, name: error.name || error.constructor.name, message: message.slice(0, 500) };
  }

  private serverErrorEventType(error?: AuditErrorInfo): AuditEventType {
    if (!error) return 'SYSTEM_ERROR';
    // AES-GCM: el authTag no coincide → el template fue modificado o la clave no es la correcta.
    if (/unable to authenticate data|Unsupported state/i.test(error.message)) return 'SECURITY_TEMPLATE_INTEGRITY_FAILURE';
    if (/ConnectionError|ESOCKET|ETIMEOUT|ELOGIN|Failed to connect|Connection is closed|Login failed/i.test(`${error.name} ${error.message}`)) {
      return 'SYSTEM_DATABASE_ERROR';
    }
    return 'SYSTEM_ERROR';
  }

  private async writeFallback(entity: Partial<AuditEventEntity>, err: unknown): Promise<void> {
    if (!this.storageWarningLogged) {
      this.storageWarningLogged = true;
      this.logger.error(
        `No se pudo escribir en audit.AuditEvent (${err instanceof Error ? err.message : String(err)}). ` +
          `¿Se ejecutó bio_u_db/06_create_audit_tables.sql? Los eventos se guardan en ${this.config.fallbackFile} mientras tanto.`,
      );
    }
    try {
      const file = path.resolve(process.cwd(), this.config.fallbackFile);
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.appendFile(file, `${JSON.stringify(entity)}\n`, 'utf8');
    } catch (fileErr) {
      this.logger.error(`Tampoco se pudo escribir el archivo de respaldo de auditoría: ${String(fileErr)}`);
    }
  }

  private escapeLike(value: string): string {
    return value.replace(/[\\%_[]/g, (char) => `\\${char}`);
  }

  /** Celda CSV con comillas y protección contra inyección de fórmulas en Excel. */
  private csvCell(value: unknown): string {
    if (value === null || value === undefined) return '';
    let text = value instanceof Date ? value.toISOString() : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }
}
