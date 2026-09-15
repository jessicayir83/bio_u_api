import { BadRequestException, Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuditService } from './audit.service';
import { AuditEventsQueryDto } from './dto/audit-events-query.dto';
import { AcknowledgeAlertDto } from './dto/acknowledge-alert.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';

const MAX_SUMMARY_HOURS = 24 * 90;

function parseEventId(id: string): string {
  if (!/^\d{1,19}$/.test(id)) {
    throw new BadRequestException('Id de evento inválido.');
  }
  return id;
}

/** Dashboard de auditoría: exclusivo de Admin. Consultarlo también queda auditado (AUDIT_VIEWED). */
@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('summary')
  summary(@Query('hours') hours?: string) {
    const parsed = hours ? parseInt(hours, 10) : 24;
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_SUMMARY_HOURS) {
      throw new BadRequestException(`hours debe estar entre 1 y ${MAX_SUMMARY_HOURS}.`);
    }
    const to = new Date();
    const from = new Date(to.getTime() - parsed * 60 * 60 * 1000);
    this.auditService.annotate({ eventType: 'AUDIT_VIEWED', details: { view: 'summary', hours: parsed } });
    return this.auditService.summary(from, to);
  }

  @Get('catalog')
  catalog() {
    this.auditService.annotate({ eventType: 'AUDIT_VIEWED', details: { view: 'catalog' } });
    return this.auditService.catalog();
  }

  @Get('events')
  events(@Query() query: AuditEventsQueryDto) {
    this.auditService.annotate({
      eventType: 'AUDIT_VIEWED',
      details: { view: 'events', filters: this.auditService.describeFilters(query), page: query.page ?? 1 },
    });
    return this.auditService.findEvents(query);
  }

  // Antes de 'events/:id' para que "export" no se tome como id.
  @Get('events/export')
  async export(@Query() query: AuditEventsQueryDto, @Res() res: Response) {
    const { csv, rows, truncated } = await this.auditService.exportCsv(query);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="auditoria-${stamp}.csv"`);
    res.setHeader('X-Export-Rows', String(rows));
    res.setHeader('X-Export-Truncated', String(truncated));
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Export-Rows, X-Export-Truncated');
    res.send(csv);
  }

  @Get('events/:id')
  event(@Param('id') id: string) {
    const eventId = parseEventId(id);
    this.auditService.annotate({ eventType: 'AUDIT_VIEWED', targetType: 'AuditEvent', targetId: eventId, details: { view: 'event' } });
    return this.auditService.findEvent(eventId);
  }

  @Post('events/:id/acknowledge')
  acknowledge(@Param('id') id: string, @Body() dto: AcknowledgeAlertDto, @CurrentUser() user: AuthenticatedUser) {
    return this.auditService.acknowledge(parseEventId(id), user, dto.note);
  }
}
