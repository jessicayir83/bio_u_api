import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * audit.AuditEvent — append-only (el trigger TR_AuditEvent_Immutable
 * rechaza UPDATE/DELETE). Solo se inserta con `repository.insert`, nunca
 * `save` (que podría intentar un UPDATE).
 */
@Entity({ name: 'AuditEvent', schema: 'audit' })
export class AuditEventEntity {
  // BIGINT llega como string desde mssql: se mantiene string para no perder precisión.
  @PrimaryGeneratedColumn({ name: 'Id', type: 'bigint' })
  id: string;

  @Column({ name: 'OccurredAt', type: 'datetime2', precision: 3 })
  occurredAt: Date;

  @Column({ name: 'Severity', type: 'nvarchar', length: 10 })
  severity: string;

  @Column({ name: 'Category', type: 'nvarchar', length: 30 })
  category: string;

  @Column({ name: 'EventType', type: 'nvarchar', length: 80 })
  eventType: string;

  @Column({ name: 'Outcome', type: 'nvarchar', length: 20 })
  outcome: string;

  @Column({ name: 'ActorType', type: 'nvarchar', length: 20 })
  actorType: string;

  @Column({ name: 'ActorUserId', type: 'int', nullable: true })
  actorUserId: number | null;

  @Column({ name: 'ActorUsername', type: 'nvarchar', length: 100, nullable: true })
  actorUsername: string | null;

  @Column({ name: 'SourceIp', type: 'nvarchar', length: 64, nullable: true })
  sourceIp: string | null;

  @Column({ name: 'UserAgent', type: 'nvarchar', length: 400, nullable: true })
  userAgent: string | null;

  @Column({ name: 'HttpMethod', type: 'nvarchar', length: 10, nullable: true })
  httpMethod: string | null;

  @Column({ name: 'Path', type: 'nvarchar', length: 400, nullable: true })
  path: string | null;

  @Column({ name: 'StatusCode', type: 'int', nullable: true })
  statusCode: number | null;

  @Column({ name: 'DurationMs', type: 'int', nullable: true })
  durationMs: number | null;

  @Column({ name: 'TargetType', type: 'nvarchar', length: 40, nullable: true })
  targetType: string | null;

  @Column({ name: 'TargetId', type: 'nvarchar', length: 64, nullable: true })
  targetId: string | null;

  @Column({ name: 'Message', type: 'nvarchar', length: 1000, nullable: true })
  message: string | null;

  @Column({ name: 'Details', type: 'nvarchar', length: 'MAX', nullable: true })
  details: string | null;

  @Column({ name: 'CorrelationId', type: 'nvarchar', length: 64, nullable: true })
  correlationId: string | null;
}
