import { AsyncLocalStorage } from 'async_hooks';
import type { AuditEventType, AuditOutcome, AuditSeverity } from './audit.constants';

/**
 * Lo que un servicio agrega al evento del request en curso (vía
 * `AuditService.annotate`). Al terminar el request, el middleware HTTP
 * escribe UNA fila combinando esto con los datos del request (IP, ruta,
 * status, duración, usuario).
 */
export interface AuditAnnotation {
  eventType?: AuditEventType;
  severity?: AuditSeverity;
  outcome?: AuditOutcome;
  targetType?: string;
  targetId?: string | number;
  message?: string;
  details?: Record<string, unknown>;
  /** Para eventos sin usuario autenticado que igual refieren a una cuenta (ej. username de un login fallido). */
  actorUserId?: number;
  actorUsername?: string;
}

export interface AuditErrorInfo {
  status: number;
  name: string;
  message: string;
}

export interface AuditRequestContext {
  correlationId: string;
  startedAt: number;
  sourceIp: string | null;
  userAgent: string | null;
  annotation: AuditAnnotation;
  error?: AuditErrorInfo;
}

export const auditContextStorage = new AsyncLocalStorage<AuditRequestContext>();
