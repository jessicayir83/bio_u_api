import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfig } from '../../../config/configuration';
import { AuthenticatedUser, JwtPayload } from '../interfaces/jwt-payload.interface';
import { UserEntity } from '../entities/user.entity';
import { AuditService } from '../../audit/audit.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @InjectRepository(UserEntity) private readonly userRepository: Repository<UserEntity>,
    private readonly auditService: AuditService,
  ) {
    const auth = configService.get<AppConfig['auth']>('auth')!;
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: auth.jwtSecret,
      issuer: auth.issuer,
      audience: auth.audience,
    });
  }

  /**
   * El token solo prueba quién era el usuario al emitirse. Los roles y el estado
   * se releen de la BD en cada request: si un Admin desactiva a alguien o le
   * cambia los roles, el efecto es inmediato y no 15 min después (lo que dura el
   * access token). Los roles del token se ignoran a propósito.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
      relations: { userRoles: { role: true } },
    });

    if (!user || !user.isActive) {
      this.auditService.annotate({
        eventType: 'AUTH_TOKEN_INVALID',
        actorUserId: payload.sub,
        details: { reason: user ? 'USER_INACTIVE' : 'USER_NOT_FOUND' },
      });
      throw new UnauthorizedException('Sesión no válida.');
    }

    return { userId: user.id, username: user.username, roles: user.userRoles.map((userRole) => userRole.role.name) };
  }
}
