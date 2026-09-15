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

@Injectable()
export class AuthService {
  private readonly authConfig: AppConfig['auth'];

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(RefreshTokenEntity)
    private readonly refreshTokenRepository: Repository<RefreshTokenEntity>,
    private readonly jwtService: JwtService,
    configService: ConfigService,
  ) {
    this.authConfig = configService.get<AppConfig['auth']>('auth')!;
  }

  /**
   * No distingue "usuario no existe" de "password incorrecta" para evitar
   * enumeración de usuarios.
   */
  async validateUser(username: string, password: string): Promise<UserEntity> {
    const user = await this.userRepository.findOne({
      where: { username },
      relations: { userRoles: { role: true } },
    });

    const passwordMatches = user ? await bcrypt.compare(password, user.passwordHash) : false;

    if (!user || !user.isActive || !passwordMatches) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    return user;
  }

  async login(user: UserEntity): Promise<AuthResponse> {
    const roles = user.userRoles.map((userRole) => userRole.role.name);
    const tokens = await this.issueTokens(user.id, user.username, roles);

    user.lastLoginAt = new Date();
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
      throw new UnauthorizedException('Refresh token inválido.');
    }

    if (existing.revokedAt) {
      await this.revokeAllSessions(existing.userId);
      throw new UnauthorizedException('Refresh token inválido.');
    }

    if (existing.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token expirado.');
    }

    const roles = existing.user.userRoles.map((userRole) => userRole.role.name);
    const tokens = await this.issueTokens(existing.userId, existing.user.username, roles);

    existing.revokedAt = new Date();
    existing.replacedByTokenHash = this.hashToken(tokens.refreshToken);
    await this.refreshTokenRepository.save(existing);

    return tokens;
  }

  async logout(userId: number, refreshTokenPlain: string): Promise<void> {
    const tokenHash = this.hashToken(refreshTokenPlain);
    const existing = await this.refreshTokenRepository.findOne({ where: { tokenHash } });

    if (!existing) {
      return;
    }

    if (existing.userId !== userId) {
      throw new ForbiddenException('El refresh token no pertenece al usuario autenticado.');
    }

    if (!existing.revokedAt) {
      existing.revokedAt = new Date();
      await this.refreshTokenRepository.save(existing);
    }
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
      throw new BadRequestException('La contraseña actual es incorrecta.');
    }
    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      throw new BadRequestException('La nueva contraseña debe ser distinta de la actual.');
    }

    user.passwordHash = await bcrypt.hash(newPassword, this.authConfig.bcryptSaltRounds);
    await this.userRepository.save(user);
    await this.revokeAllSessions(user.id);

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
