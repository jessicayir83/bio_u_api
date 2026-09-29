import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export const CONSENT_PURPOSES = ['BIOMETRIC_PROCESSING'] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export const CONSENT_CHANNELS = ['KIOSK', 'PANEL'] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];

/**
 * [identity].PersonConsent — consentimiento otorgado por una persona (o
 * confirmado por un operador) antes de tratar sus datos biométricos.
 * Nunca guarda nombres, fotos ni datos biométricos.
 */
@Entity({ name: 'PersonConsent', schema: 'identity' })
export class PersonConsentEntity {
  @PrimaryGeneratedColumn({ name: 'Id' })
  id: number;

  @Column({ name: 'PersonId', type: 'int' })
  personId: number;

  @Column({ name: 'Purpose', type: 'nvarchar', length: 40 })
  purpose: ConsentPurpose;

  /** Versión de los textos legales que la persona vio al aceptar. */
  @Column({ name: 'PolicyVersion', type: 'nvarchar', length: 40 })
  policyVersion: string;

  @Column({ name: 'Channel', type: 'nvarchar', length: 20 })
  channel: ConsentChannel;

  @Column({ name: 'GrantedAt', type: 'datetime2', precision: 3 })
  grantedAt: Date;

  /** Solo por PANEL: el operador que confirmó el consentimiento (columna simple, sin FK a `security`). */
  @Column({ name: 'RecordedByUserId', type: 'int', nullable: true })
  recordedByUserId: number | null;

  @Column({ name: 'RevokedAt', type: 'datetime2', precision: 3, nullable: true })
  revokedAt: Date | null;
}
