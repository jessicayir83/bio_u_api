import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { AuditService } from '../../audit/audit.service';
import { IS_PUBLIC_KEY } from '../decorators/access.decorator';

/** Guard global (APP_GUARD): exige sesión válida salvo en rutas marcadas `@Public()`. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly auditService: AuditService,
    private readonly reflector: Reflector,
  ) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  /**
   * Distingue el motivo del rechazo para la auditoría: un token vencido es
   * rutina (el frontend lo renueva solo), uno con firma inválida no.
   */
  handleRequest<TUser>(err: unknown, user: TUser, info: unknown, context: ExecutionContext, status?: unknown): TUser {
    if (err || !user) {
      const reason = info instanceof Error ? info : null;
      let eventType: 'AUTH_TOKEN_EXPIRED' | 'AUTH_TOKEN_INVALID' | 'AUTH_TOKEN_MISSING' = 'AUTH_TOKEN_INVALID';
      if (reason?.name === 'TokenExpiredError') eventType = 'AUTH_TOKEN_EXPIRED';
      else if (!err && (!reason || reason.message === 'No auth token')) eventType = 'AUTH_TOKEN_MISSING';
      // Si la estrategia ya anotó el motivo (usuario desactivado/inexistente), no se pisa el detalle.
      if (!err) {
        this.auditService.annotate({ eventType, details: { reason: reason?.message ?? null } });
      }
    }
    return super.handleRequest(err, user, info, context, status);
  }
}
