import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Bitácora de intentos de ingreso desde el kiosco. **Nunca** guarda la
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

  @Column({ name: 'Distance', type: 'float', nullable: true })
  distance: number | null;

  @Column({ name: 'SourceIp', type: 'nvarchar', length: 64, nullable: true })
  sourceIp: string | null;

  @CreateDateColumn({ name: 'OccurredAt', type: 'datetime2' })
  occurredAt: Date;
}
