import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { BiometricPersonEntity } from '../../persons/entities/biometric-person.entity';

export type EnrollmentStatus = 'Pending' | 'Completed' | 'Revoked';

/**
 * Solo estructura/estado en Fase 3 — sin datos biométricos. La captura
 * real y biometric.Template se activan en Fase 5.
 */
@Entity({ name: 'Enrollment', schema: 'biometric' })
export class EnrollmentEntity {
  @PrimaryGeneratedColumn({ name: 'Id' })
  id: number;

  @Column({ name: 'PersonId' })
  personId: number;

  @ManyToOne(() => BiometricPersonEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'PersonId' })
  person: BiometricPersonEntity;

  @Column({ name: 'Modality', type: 'nvarchar', length: 30 })
  modality: string;

  @Column({ name: 'Status', type: 'nvarchar', length: 20, default: 'Pending' })
  status: EnrollmentStatus;

  // Referencia a security.User(Id). Sin relación TypeORM a propósito
  // (ver CLAUDE.md: no acoplar módulos de fases distintas).
  @Column({ name: 'CreatedByUserId' })
  createdByUserId: number;

  @CreateDateColumn({ name: 'CreatedAt', type: 'datetime2' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'UpdatedAt', type: 'datetime2', nullable: true })
  updatedAt: Date | null;

  @Column({ name: 'CompletedAt', type: 'datetime2', nullable: true })
  completedAt: Date | null;
}
