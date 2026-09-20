import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { BiometricPersonEntity } from '../../persons/entities/biometric-person.entity';
import { EnrollmentEntity } from './enrollment.entity';
import { encryptedVectorTransformer } from '../../../common/encryption/vector-encryption.transformer';
// Tipos puros (no entidades ni servicios): `face-quality.ts` es un módulo portable,
// sin dependencias de Nest, y es la única fuente de verdad de estos valores.
import type { FaceDetectorKind, FacePoseStep } from '../../biometric-providers/face/face-quality';

/** De dónde salió el vector: una captura de registro, o aprendido de un ingreso reconocido (Nivel 2). */
export type TemplateSource = 'ENROLLMENT' | 'ADAPTIVE';

/**
 * Vector biométrico resultante de completar un Enrollment. `vectorJson`
 * se cifra/descifra automáticamente en disco (AES-256-GCM, Fase 7) vía
 * `encryptedVectorTransformer` — el resto del código lo sigue tratando
 * como un string JSON plano.
 *
 * Los campos de procedencia (`source`, `detector`, `poseStep`) y de calidad
 * los agregó el Nivel 2 (script 09): sin ellos no había forma de saber con
 * qué detector se generó un vector ni de distinguir lo capturado en un
 * registro de lo que el sistema aprendió solo. `revokedAt` es baja lógica:
 * el template deja de usarse para reconocer, pero el vector nunca se borra.
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

  @Column({ name: 'Source', type: 'nvarchar', length: 20, default: 'ENROLLMENT' })
  source: TemplateSource;

  /** `null` = template anterior al script 09: no se sabe con qué detector se generó. */
  @Column({ name: 'Detector', type: 'nvarchar', length: 10, nullable: true })
  detector: FaceDetectorKind | null;

  /** `null` = captura no guiada (registro viejo, subida de archivo, adaptativo). */
  @Column({ name: 'PoseStep', type: 'nvarchar', length: 20, nullable: true })
  poseStep: FacePoseStep | null;

  @Column({ name: 'DetectionScore', type: 'float', nullable: true })
  detectionScore: number | null;

  @Column({ name: 'YawOffset', type: 'float', nullable: true })
  yawOffset: number | null;

  @Column({ name: 'Sharpness', type: 'float', nullable: true })
  sharpness: number | null;

  /** Veces que este template fue el más cercano en un reconocimiento concedido. */
  @Column({ name: 'MatchCount', type: 'int', default: 0 })
  matchCount: number;

  @Column({ name: 'LastMatchedAt', type: 'datetime2', nullable: true })
  lastMatchedAt: Date | null;

  /** Baja lógica: deja de usarse para reconocer, pero el vector se conserva. */
  @Column({ name: 'RevokedAt', type: 'datetime2', nullable: true })
  revokedAt: Date | null;

  // Columna simple a propósito: no se importa la entidad de `auth` desde acá (ver CLAUDE.md).
  @Column({ name: 'RevokedByUserId', type: 'int', nullable: true })
  revokedByUserId: number | null;

  @Column({ name: 'RevokedReason', type: 'nvarchar', length: 200, nullable: true })
  revokedReason: string | null;

  /**
   * Solo adaptativos: de qué escaneo salió y con qué distancia se aceptó.
   * Permite reconstruir hacia atrás qué ingreso, desde qué IP y a qué hora
   * generó cada vector que el sistema aprendió solo.
   */
  @Column({ name: 'SourceAccessLogId', type: 'int', nullable: true })
  sourceAccessLogId: number | null;

  @Column({ name: 'SourceDistance', type: 'float', nullable: true })
  sourceDistance: number | null;

  @CreateDateColumn({ name: 'CreatedAt', type: 'datetime2' })
  createdAt: Date;
}
