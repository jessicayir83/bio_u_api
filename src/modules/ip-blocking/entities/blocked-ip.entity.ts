import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** security.BlockedIp — historial de bloqueos manuales de IP (nunca se borran filas). */
@Entity({ name: 'BlockedIp', schema: 'security' })
export class BlockedIpEntity {
  @PrimaryGeneratedColumn({ name: 'Id' })
  id: number;

  @Column({ name: 'IpAddress', type: 'nvarchar', length: 64 })
  ipAddress: string;

  @Column({ name: 'Reason', type: 'nvarchar', length: 500 })
  reason: string;

  @Column({ name: 'SourceAuditEventId', type: 'bigint', nullable: true })
  sourceAuditEventId: string | null;

  @Column({ name: 'SourceEventType', type: 'nvarchar', length: 80, nullable: true })
  sourceEventType: string | null;

  @Column({ name: 'BlockedByUserId', type: 'int' })
  blockedByUserId: number;

  @Column({ name: 'BlockedByUsername', type: 'nvarchar', length: 100 })
  blockedByUsername: string;

  @Column({ name: 'BlockedAt', type: 'datetime2', precision: 3 })
  blockedAt: Date;

  @Column({ name: 'ExpiresAt', type: 'datetime2', precision: 3, nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'UnblockedAt', type: 'datetime2', precision: 3, nullable: true })
  unblockedAt: Date | null;

  @Column({ name: 'UnblockedByUserId', type: 'int', nullable: true })
  unblockedByUserId: number | null;

  @Column({ name: 'UnblockedByUsername', type: 'nvarchar', length: 100, nullable: true })
  unblockedByUsername: string | null;

  @Column({ name: 'UnblockReason', type: 'nvarchar', length: 500, nullable: true })
  unblockReason: string | null;
}
