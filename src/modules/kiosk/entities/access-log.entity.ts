import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export const SCAN_STATUSES = ['GRANTED', 'DENIED', 'AMBIGUOUS', 'MATCH', 'NO_MATCH', 'REJECTED'] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];
export type ScanChannel = 'KIOSK_CHECKIN' | 'PANEL_VERIFICATION';

/**
 * Historial de escaneos de rostro: ingresos del kiosco y verificaciones 1:1
 * del panel, con su estado. **Nunca** guarda la
 * foto ni el descriptor biométrico — solo el resultado del evento.
 * `personId` es null cuando la identificación 1:N no reconoció a nadie.
 */
@Entity({ name: 'AccessLog', schema: 'biometric' })
export class AccessLogEntity {
  @PrimaryGeneratedColumn({ name: 'Id' })
  id: number;

  // Referencia a identity.BiometricPerson(Id); columna simple, sin relación
  // TypeORM (ver CLAUDE.md: referencias incidentales van como columna).
  @Column({ name: 'PersonId', nullable: true, type: 'int' })
  personId: number | null;

  @Column({ name: 'Modality', type: 'nvarchar', length: 30 })
  modality: string;

  @Column({ name: 'Granted', type: 'bit' })
  granted: boolean;

  @Column({ name: 'Status', type: 'nvarchar', length: 20 })
  status: ScanStatus;

  @Column({ name: 'Channel', type: 'nvarchar', length: 20, default: 'KIOSK_CHECKIN' })
  channel: ScanChannel;

  @Column({ name: 'Distance', type: 'float', nullable: true })
  distance: number | null;

  @Column({ name: 'SourceIp', type: 'nvarchar', length: 64, nullable: true })
  sourceIp: string | null;

  @CreateDateColumn({ name: 'OccurredAt', type: 'datetime2' })
  occurredAt: Date;
}
