import type { NextFunction, Request, Response } from 'express';
import type { AuditService } from '../audit/audit.service';
import type { IpBlockService } from './ip-block.service';

/**
 * Rechaza con 403 cualquier request de una IP bloqueada, en TODO el API.
 * Se monta en main.ts justo después del middleware de auditoría, así el
 * intento rechazado igual queda registrado (SECURITY_BLOCKED_IP_REQUEST).
 */
export function createIpBlockMiddleware(ipBlockService: IpBlockService, auditService: AuditService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method === 'OPTIONS') {
      next();
      return;
    }

    const block = ipBlockService.findActiveBlock(req.ip ?? req.socket.remoteAddress);
    if (!block) {
      next();
      return;
    }

    auditService.annotate({
      eventType: 'SECURITY_BLOCKED_IP_REQUEST',
      targetType: 'BlockedIp',
      targetId: block.id,
      details: { expiresAt: block.expiresAt },
    });
    res.status(403).json({
      statusCode: 403,
      error: 'Forbidden',
      message: 'El acceso desde esta red está bloqueado. Si creés que es un error, contactá al administrador.',
    });
  };
}
