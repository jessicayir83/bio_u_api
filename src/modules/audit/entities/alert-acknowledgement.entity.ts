import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** audit.AlertAcknowledgement — revisión de una alerta, sin tocar el evento original (inmutable). */
@Entity({ name: 'AlertAcknowledgement', schema: 'audit' })
export class AlertAcknowledgementEntity {
  @PrimaryGeneratedColumn({ name: 'Id' })
  id: number;

  @Column({ name: 'AuditEventId', type: 'bigint' })
  auditEventId: string;

  @Column({ name: 'AcknowledgedByUserId', type: 'int' })
  acknowledgedByUserId: number;

  @Column({ name: 'AcknowledgedByUsername', type: 'nvarchar', length: 100 })
  acknowledgedByUsername: string;

  @Column({ name: 'Note', type: 'nvarchar', length: 500, nullable: true })
  note: string | null;

  @Column({ name: 'AcknowledgedAt', type: 'datetime2', precision: 3 })
  acknowledgedAt: Date;
}
