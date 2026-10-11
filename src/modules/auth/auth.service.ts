import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { UserEntity } from './entities/user.entity';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import { AppConfig } from '../../config/configuration';
import { AuthResponse, AuthTokens } from './interfaces/auth-response.interface';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class AuthService {
  private readonly authConfig: AppConfig['auth'];
  private readonly dummyPasswordHash: string;

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(RefreshTokenEntity)
    private readonly refreshTokenRepository: Repository<RefreshTokenEntity>,
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService,
    configService: ConfigService,
  ) {
    this.authConfig = configService.get<AppConfig['auth']>('auth')!;
    // Hash falso para igualar el tiempo de respuesta cuando el usuario no existe o está bloqueado.
    this.dummyPasswordHash = bcrypt.hashSync(randomBytes(16).toString('hex'), this.authConfig.bcryptSaltRounds);
  }

  /**
   * No distingue "usuario no existe", "password incorrecta" ni "cuenta bloqueada" para evitar
   * enumeración de usuarios (la respuesta es siempre la misma). La auditoría sí
   * guarda el motivo real, porque solo la ve un Admin.
   *
   * Bloqueo temporal: tras `lockoutMaxAttempts` fallos consecutivos la cuenta queda
   * bloqueada `lockoutMinutes` (script bio_u_db/11_user_lockout.sql). Siempre se hace
   * un bcrypt.compare (contra un hash falso si no hay usuario o está bloqueado) para que
   * el tiempo de respuesta no delate si la cuenta existe.
   */
  async validateUser(username: string, password: string): Promise<UserEntity> {
    const user = await this.userRepository.findOne({
      where: { username },
      relations: { userRoles: { role: true } },
    });

    const isLocked = !!user?.lockedUntil && user.lockedUntil.getTime() > Date.now();
    const passwordMatches = await bcrypt.compare(password, user && !isLocked ? user.passwordHash : this.dummyPasswordHash);

    if (user && isLocked) {
      this.auditService.annotate({
        eventType: 'AUTH_LOGIN_BLOCKED_LOCKED',
        actorUserId: user.id,
        actorUsername: user.username,
        details: { lockedUntil: user.lockedUntil },
      });
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    if (!user || !user.isActive || !passwordMatches) {
      if (user && !user.isActive) {
        // Incluye intentos con la cuenta de sistema `kiosk`, que está inactiva a propósito.
        this.auditService.annotate({
          eventType: 'AUTH_LOGIN_INACTIVE_ACCOUNT',
          actorUserId: user.id,
          actorUsername: user.username,
          details: { passwordMatched: passwordMatches },
        });
      } else if (user) {
        await this.registerFailedAttempt(user);
      } else {
        this.auditService.annotate({
          eventType: 'AUTH_LOGIN_FAILED',
          actorUsername: username,
          details: { reason: 'USER_NOT_FOUND' },
        });
      }
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    return user;
  }

  /** Cuenta el fallo; al llegar al tope bloquea la cuenta (y deja una alerta SEV2 en la bitácora). */
  private async registerFailedAttempt(user: UserEntity): Promise<void> {
    const attempts = (user.failedAttempts ?? 0) + 1;
    const reachedLimit = attempts >= this.authConfig.lockoutMaxAttempts;

    user.failedAttempts = reachedLimit ? 0 : attempts;
    user.lockedUntil = reachedLimit ? new Date(Date.now() + this.authConfig.lockoutMinutes * 60 * 1000) : user.lockedUntil;
    await this.userRepository.update(user.id, { failedAttempts: user.failedAttempts, lockedUntil: user.lockedUntil });

    this.auditService.annotate({
      eventType: reachedLimit ? 'AUTH_ACCOUNT_LOCKED' : 'AUTH_LOGIN_FAILED',
      actorUserId: user.id,
      actorUsername: user.username,
      details: reachedLimit
        ? { reason: 'TOO_MANY_FAILED_ATTEMPTS', lockedUntil: user.lockedUntil, lockoutMinutes: this.authConfig.lockoutMinutes }
        : { reason: 'BAD_PASSWORD', failedAttempts: attempts },
    });
  }


  async login(user: UserEntity): Promise<AuthResponse> {
    const roles = user.userRoles.map((userRole) => userRole.role.name);
    const tokens = await this.issueTokens(user.id, user.username, roles);

    // "IP inusual": primera vez que esta cuenta entra desde esta IP (si ya tenía historial).
    const history = await this.auditService.loginHistory(user.id, this.auditService.currentSourceIp());
    const isNewIp = history.hasPreviousLogins && !history.hasLoginFromIp;
    this.auditService.annotate({
      eventType: isNewIp ? 'AUTH_LOGIN_NEW_IP' : 'AUTH_LOGIN_SUCCESS',
      // Una cuenta Admin entrando desde una IP nueva merece más atención.
      severity: isNewIp && roles.includes('Admin') ? 'SEV2' : undefined,
      actorUserId: user.id,
      actorUsername: user.username,
      details: { roles, previousLastLoginAt: user.lastLoginAt },
    });

    user.lastLoginAt = new Date();
    // Login correcto: se limpia el contador de fallos y cualquier bloqueo vencido.
    user.failedAttempts = 0;
    user.lockedUntil = null;
    await this.userRepository.save(user);

    return {
      ...tokens,
      user: { id: user.id, username: user.username, email: user.email, roles },
    };
  }

  /**
   * Rotación con detección de reuso: si el refresh token recibido ya fue
   * revocado (es decir, alguien vuelve a usar un token viejo de la cadena
   * de rotación), se asume robo y se revoca TODA la sesión del usuario.
   */
  async refresh(refreshTokenPlain: string): Promise<AuthTokens> {
    const tokenHash = this.hashToken(refreshTokenPlain);
    const existing = await this.refreshTokenRepository.findOne({
      where: { tokenHash },
      relations: { user: { userRoles: { role: true } } },
    });

    if (!existing) {
      this.auditService.annotate({ eventType: 'AUTH_REFRESH_FAILED', details: { reason: 'TOKEN_NOT_FOUND' } });
      throw new UnauthorizedException('Refresh token inválido.');
    }

    const actor = { actorUserId: existing.userId, actorUsername: existing.user?.username };

    if (existing.revokedAt) {
      await this.revokeAllSessions(existing.userId);
      this.auditService.annotate({
        eventType: 'AUTH_REFRESH_TOKEN_REUSE',
        ...actor,
        targetType: 'User',
        targetId: existing.userId,
        details: { tokenRevokedAt: existing.revokedAt, allSessionsRevoked: true },
      });
      throw new UnauthorizedException('Refresh token inválido.');
    }

    if (existing.expiresAt.getTime() < Date.now()) {
      this.auditService.annotate({ eventType: 'AUTH_REFRESH_FAILED', ...actor, details: { reason: 'TOKEN_EXPIRED' } });
      throw new UnauthorizedException('Refresh token expirado.');
    }

    // Un usuario desactivado no puede seguir renovando su sesión.
    if (!existing.user?.isActive) {
      this.auditService.annotate({ eventType: 'AUTH_REFRESH_FAILED', ...actor, details: { reason: 'USER_INACTIVE' } });
      throw new UnauthorizedException('Refresh token inválido.');
    }

    const roles = existing.user.userRoles.map((userRole) => userRole.role.name);
    const tokens = await this.issueTokens(existing.userId, existing.user.username, roles);

    existing.revokedAt = new Date();
    existing.replacedByTokenHash = this.hashToken(tokens.refreshToken);
    await this.refreshTokenRepository.save(existing);

    this.auditService.annotate({ eventType: 'AUTH_TOKEN_REFRESHED', ...actor });
    return tokens;
  }

  async logout(userId: number, refreshTokenPlain: string): Promise<void> {
    const tokenHash = this.hashToken(refreshTokenPlain);
    const existing = await this.refreshTokenRepository.findOne({ where: { tokenHash } });

    if (!existing) {
      this.auditService.annotate({ eventType: 'AUTH_LOGOUT', details: { tokenFound: false } });
      return;
    }

    if (existing.userId !== userId) {
      this.auditService.annotate({
        eventType: 'AUTH_ACCESS_DENIED_ROLE',
        message: 'Intento de cerrar la sesión de otro usuario con su refresh token',
        details: { tokenOwnerUserId: existing.userId },
      });
      throw new ForbiddenException('El refresh token no pertenece al usuario autenticado.');
    }

    if (!existing.revokedAt) {
      existing.revokedAt = new Date();
      await this.refreshTokenRepository.save(existing);
    }
    this.auditService.annotate({ eventType: 'AUTH_LOGOUT' });
  }

  /**
   * El usuario cambia su propia contraseña. Revoca todas sus sesiones (por
   * si la contraseña vieja estaba comprometida) y devuelve tokens nuevos
   * para que la sesión desde la que se hizo el cambio siga abierta.
   * Los access tokens ya emitidos siguen valiendo hasta que expiran
   * (JWT_ACCESS_EXPIRES_IN, 15 min por defecto).
   */
  async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<AuthTokens> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: { userRoles: { role: true } },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Usuario no válido.');
    }

    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      this.auditService.annotate({ eventType: 'AUTH_PASSWORD_CHANGE_FAILED', details: { reason: 'WRONG_CURRENT_PASSWORD' } });
      throw new BadRequestException('La contraseña actual es incorrecta.');
    }
    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      this.auditService.annotate({ eventType: 'AUTH_PASSWORD_CHANGE_FAILED', details: { reason: 'SAME_AS_CURRENT' } });
      throw new BadRequestException('La nueva contraseña debe ser distinta de la actual.');
    }

    user.passwordHash = await bcrypt.hash(newPassword, this.authConfig.bcryptSaltRounds);
    await this.userRepository.save(user);
    await this.revokeAllSessions(user.id);
    this.auditService.annotate({ eventType: 'AUTH_PASSWORD_CHANGED', targetType: 'User', targetId: user.id, details: { otherSessionsRevoked: true } });

    const roles = user.userRoles.map((userRole) => userRole.role.name);
    return this.issueTokens(user.id, user.username, roles);
  }

  /** Revoca todos los refresh tokens vigentes del usuario (cierra todas sus sesiones). */
  async revokeAllSessions(userId: number): Promise<void> {
    await this.refreshTokenRepository.update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  private async issueTokens(userId: number, username: string, roles: string[]): Promise<AuthTokens> {
    const accessToken = await this.jwtService.signAsync({ sub: userId, username, roles });

    const refreshTokenPlain = randomBytes(64).toString('hex');
    const refreshTokenEntity = this.refreshTokenRepository.create({
      userId,
      tokenHash: this.hashToken(refreshTokenPlain),
      expiresAt: new Date(Date.now() + this.authConfig.refreshTokenExpiresInDays * 24 * 60 * 60 * 1000),
    });
    await this.refreshTokenRepository.save(refreshTokenEntity);

    return {
      accessToken,
      refreshToken: refreshTokenPlain,
      tokenType: 'Bearer',
      expiresIn: this.parseExpiresInSeconds(this.authConfig.accessTokenExpiresIn),
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private parseExpiresInSeconds(value: string): number {
    const match = /^(\d+)([smhd])$/.exec(value);
    if (!match) {
      return 900;
    }
    const amount = parseInt(match[1], 10);
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return amount * multipliers[match[2]];
  }
}
