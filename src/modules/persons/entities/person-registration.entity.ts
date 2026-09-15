import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export const REGISTRATION_CHANNELS = ['KIOSK', 'PANEL'] as const;
export type RegistrationChannel = (typeof REGISTRATION_CHANNELS)[number];

export const REGISTRATION_STATUSES = [
  'SUCCESS',
  'DUPLICATE_ID',
  'DUPLICATE_FACE',
  'IDENTITY_MISMATCH',
  'REJECTED_PHOTOS',
] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

/**
 * [identity].PersonRegistration — cada intento de registro (kiosco o
 * panel) con su resultado. Sirve para ver cuándo se registró cada persona
 * y detectar duplicados o intentos con la identificación de otra persona.
 * Nunca guarda nombres, fotos ni datos biométricos.
 */
@Entity({ name: 'PersonRegistration', schema: 'identity' })
export class PersonRegistrationEntity {
  @PrimaryGeneratedColumn({ name: 'Id' })
  id: number;

  @Column({ name: 'OccurredAt', type: 'datetime2', precision: 3 })
  occurredAt: Date;

  @Column({ name: 'Channel', type: 'nvarchar', length: 20 })
  channel: RegistrationChannel;

  @Column({ name: 'Status', type: 'nvarchar', length: 30 })
  status: RegistrationStatus;

  @Column({ name: 'IdentificationType', type: 'nvarchar', length: 20 })
  identificationType: string;

  @Column({ name: 'IdentificationNumber', type: 'nvarchar', length: 50 })
  identificationNumber: string;

  // Columnas simples (sin relación TypeORM), igual que CreatedByUserId.
  @Column({ name: 'PersonId', type: 'int', nullable: true })
  personId: number | null;

  @Column({ name: 'SourceIp', type: 'nvarchar', length: 64, nullable: true })
  sourceIp: string | null;

  @Column({ name: 'CreatedByUserId', type: 'int', nullable: true })
  createdByUserId: number | null;

  @Column({ name: 'Detail', type: 'nvarchar', length: 400, nullable: true })
  detail: string | null;
}
