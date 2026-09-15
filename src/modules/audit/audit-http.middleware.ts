import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { AuditRequestContext, auditContextStorage } from './audit-context';
import type { AuditService } from './audit.service';

/**
 * Registra CADA request HTTP (se monta en main.ts con `app.use`, antes que
 * los parsers de body, para cubrir también requests que fallan temprano:
 * JSON inválido, archivos demasiado grandes, rutas inexistentes, guards).
 *
 * Abre el contexto de auditoría del request (AsyncLocalStorage) que los
 * servicios enriquecen con `AuditService.annotate`, y escribe una sola
 * fila cuando la respuesta termina.
 *
 * Se omiten los OPTIONS (preflight de CORS): los genera el navegador solo,
 * antes de cada request real, que sí queda registrado.
 */
export function createAuditHttpMiddleware(auditService: AuditService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method === 'OPTIONS') {
      next();
      return;
    }

    const context: AuditRequestContext = {
      correlationId: randomUUID(),
      startedAt: Date.now(),
      sourceIp: req.ip ?? req.socket.remoteAddress ?? null,
      userAgent: req.get('user-agent') ?? null,
      annotation: {},
    };
    res.setHeader('X-Request-Id', context.correlationId);

    let recorded = false;
    const finalize = () => {
      if (recorded) return;
      recorded = true;
      void auditService.recordHttp(context, req, res);
    };
    res.on('finish', finalize);
    // Conexión cortada antes de responder (el cliente cerró la pestaña, timeout).
    res.on('close', finalize);

    auditContextStorage.run(context, () => next());
  };
}
