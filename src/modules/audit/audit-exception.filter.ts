import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Response } from 'express';
import { AuditService } from './audit.service';

/** Único mensaje que ve el cliente ante un fallo interno (nunca la causa real). */
export const GENERIC_ERROR_MESSAGE = 'Algo salió mal, por favor intenta más tarde.';

/**
 * Filtro global de excepciones.
 *
 * 1. Anota el error en el evento de auditoría del request.
 * 2. Escribe la causa completa (con stack) SOLO en el log interno del servidor.
 * 3. Responde al cliente un cuerpo controlado `{ statusCode, message, correlationId }`:
 *    - `HttpException` 4xx (validación, 401, 403, 404, 409, 429...): conserva su mensaje,
 *      que lo redactamos nosotros a propósito.
 *    - Todo lo demás (QueryFailedError, errores de mssql/TypeORM/TensorFlow, bugs) y
 *      cualquier 5xx: 500 con mensaje genérico. Nunca stack, tablas, rutas ni el mensaje original.
 *
 * El `correlationId` permite a soporte ubicar la causa real en el log y en `/audit`.
 */
@Catch()
export class AuditExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  constructor(private readonly auditService: AuditService) {
    super();
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      super.catch(exception, host);
      return;
    }

    this.auditService.captureException(exception);

    const response = host.switchToHttp().getResponse<Response>();
    const correlationId = this.auditService.currentCorrelationId();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown> = { statusCode, message: GENERIC_ERROR_MESSAGE };

    if (exception instanceof HttpException && exception.getStatus() < HttpStatus.INTERNAL_SERVER_ERROR) {
      statusCode = exception.getStatus();
      const raw = exception.getResponse();
      if (typeof raw === 'string') {
        body = { statusCode, message: raw };
      } else {
        const { message, error } = raw as { message?: unknown; error?: unknown };
        body = { statusCode, message: message ?? exception.message, ...(error ? { error } : {}) };
      }
    } else {
      const detail = exception instanceof Error ? (exception.stack ?? exception.message) : String(exception);
      this.logger.error(`[${correlationId ?? 'sin-correlation-id'}] ${detail}`);
    }

    if (correlationId) body.correlationId = correlationId;
    if (response.headersSent) return;
    response.status(statusCode).json(body);
  }
}
