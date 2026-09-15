import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuditService } from '../../audit/audit.service';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly auditService: AuditService) {
    super();
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
      else if (!reason || reason.message === 'No auth token') eventType = 'AUTH_TOKEN_MISSING';
      this.auditService.annotate({ eventType, details: { reason: reason?.message ?? (err instanceof Error ? err.message : null) } });
    }
    return super.handleRequest(err, user, info, context, status);
  }
}
