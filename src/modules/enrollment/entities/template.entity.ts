import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { BiometricPersonEntity } from '../../persons/entities/biometric-person.entity';
import { EnrollmentEntity } from './enrollment.entity';
import { encryptedVectorTransformer } from '../../../common/encryption/vector-encryption.transformer';

/**
 * Vector biométrico resultante de completar un Enrollment. `vectorJson`
 * se cifra/descifra automáticamente en disco (AES-256-GCM, Fase 7) vía
 * `encryptedVectorTransformer` — el resto del código lo sigue tratando
 * como un string JSON plano.
 */
@Entity({ name: 'Template', schema: 'biometric' })
export class TemplateEntity {
  @PrimaryGeneratedColumn({ name: 'Id' })
  id: number;

  @Column({ name: 'PersonId' })
  personId: number;

  @ManyToOne(() => BiometricPersonEntity)
  @JoinColumn({ name: 'PersonId' })
  person: BiometricPersonEntity;

  @Column({ name: 'EnrollmentId' })
  enrollmentId: number;

  @ManyToOne(() => EnrollmentEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'EnrollmentId' })
  enrollment: EnrollmentEntity;

  @Column({ name: 'Modality', type: 'nvarchar', length: 30, default: 'Face' })
  modality: string;

  // JSON.stringify(number[]) — el descriptor biométrico. Cifrado en disco (ver arriba).
  @Column({ name: 'Vector', type: 'nvarchar', length: 'MAX', transformer: encryptedVectorTransformer })
  vectorJson: string;

  @CreateDateColumn({ name: 'CreatedAt', type: 'datetime2' })
  createdAt: Date;
}
