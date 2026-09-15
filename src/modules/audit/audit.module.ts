import { Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditEventEntity } from './entities/audit-event.entity';
import { AlertAcknowledgementEntity } from './entities/alert-acknowledgement.entity';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditExceptionFilter } from './audit-exception.filter';

/**
 * Global a propósito: cualquier módulo inyecta AuditService para anotar sus
 * eventos sin importar AuditModule (y sin que AuditModule dependa de ellos).
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditEventEntity, AlertAcknowledgementEntity])],
  controllers: [AuditController],
  providers: [AuditService, { provide: APP_FILTER, useClass: AuditExceptionFilter }],
  exports: [AuditService],
})
export class AuditModule {}
