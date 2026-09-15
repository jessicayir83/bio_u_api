import { ArgumentsHost, Catch } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { AuditService } from './audit.service';

/**
 * Filtro global: anota el error en el evento de auditoría del request y
 * deja que Nest responda exactamente igual que antes (BaseExceptionFilter).
 */
@Catch()
export class AuditExceptionFilter extends BaseExceptionFilter {
  constructor(private readonly auditService: AuditService) {
    super();
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() === 'http') {
      this.auditService.captureException(exception);
    }
    super.catch(exception, host);
  }
}
