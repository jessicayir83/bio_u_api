import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EnrollmentEntity } from './entities/enrollment.entity';
import { TemplateEntity } from './entities/template.entity';
import { BiometricPersonEntity } from '../persons/entities/biometric-person.entity';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { UpdateEnrollmentStatusDto } from './dto/update-enrollment-status.dto';
import {
  BiometricDescriptor,
  BiometricDetectionError,
  BiometricProvider,
  FACE_PROVIDER,
  FINGERPRINT_PROVIDER,
  InvalidBiometricInputError,
} from '../biometric-providers/biometric-provider.interface';
import type { FaceDetectorKind, FacePoseStep } from '../biometric-providers/face/face-quality';
import { templateProvenanceFields } from './template-fields';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';

const SUPPORTED_MODALITIES = ['Face', 'Fingerprint'] as const;
type SupportedModality = (typeof SUPPORTED_MODALITIES)[number];

@Injectable()
export class EnrollmentService {
  private readonly providersByModality: Record<SupportedModality, BiometricProvider>;
  /** Se guarda con cada template facial: sin esto no se puede saber qué templates quedaron viejos al cambiar de detector. */
  private readonly faceDetector: FaceDetectorKind;

  constructor(
    @InjectRepository(EnrollmentEntity)
    private readonly enrollmentRepository: Repository<EnrollmentEntity>,
    @InjectRepository(TemplateEntity)
    private readonly templateRepository: Repository<TemplateEntity>,
    @InjectRepository(BiometricPersonEntity)
    private readonly personRepository: Repository<BiometricPersonEntity>,
    @Inject(FACE_PROVIDER)
    faceProvider: BiometricProvider,
    @Inject(FINGERPRINT_PROVIDER)
    fingerprintProvider: BiometricProvider,
    private readonly auditService: AuditService,
    configService: ConfigService<AppConfig, true>,
  ) {
    this.providersByModality = { Face: faceProvider, Fingerprint: fingerprintProvider };
    this.faceDetector = configService.get<AppConfig['biometrics']>('biometrics').faceDetector;
  }

  async create(dto: CreateEnrollmentDto, createdByUserId: number): Promise<EnrollmentEntity> {
    const person = await this.personRepository.findOne({ where: { id: dto.personId } });
    if (!person) {
      throw new NotFoundException(`No existe una persona con id ${dto.personId}.`);
    }
    if (!person.isActive) {
      throw new BadRequestException('No se puede crear un enrollment para una persona inactiva.');
    }

    const enrollment = await this.enrollmentRepository.save(
      this.enrollmentRepository.create({
        personId: dto.personId,
        modality: dto.modality,
        createdByUserId,
      }),
    );
    this.auditService.annotate({
      eventType: 'ENROLLMENT_CREATED',
      targetType: 'Enrollment',
      targetId: enrollment.id,
      details: { personId: dto.personId, modality: dto.modality },
    });
    return enrollment;
  }

  async findAll(personId?: number, status?: string): Promise<EnrollmentEntity[]> {
    const where: Record<string, unknown> = {};
    if (personId) where.personId = personId;
    if (status) where.status = status;

    return this.enrollmentRepository.find({ where, order: { createdAt: 'DESC' } });
  }

  async findOne(id: number): Promise<EnrollmentEntity> {
    const enrollment = await this.enrollmentRepository.findOne({ where: { id } });
    if (!enrollment) {
      throw new NotFoundException(`No existe un enrollment con id ${id}.`);
    }
    return enrollment;
  }

  async updateStatus(id: number, dto: UpdateEnrollmentStatusDto): Promise<EnrollmentEntity> {
    const enrollment = await this.findOne(id);
    const previousStatus = enrollment.status;
    enrollment.status = dto.status;
    if (dto.status === 'Completed') {
      enrollment.completedAt = new Date();
    }
    const saved = await this.enrollmentRepository.save(enrollment);
    this.auditService.annotate({
      eventType: dto.status === 'Revoked' ? 'ENROLLMENT_REVOKED' : 'ENROLLMENT_STATUS_CHANGED',
      targetType: 'Enrollment',
      targetId: id,
      details: { personId: enrollment.personId, modality: enrollment.modality, from: previousStatus, to: dto.status },
    });
    return saved;
  }

  /**
   * Captura la biometría de un enrollment Pending: extrae un descriptor por
   * muestra (con el provider de la modalidad del enrollment), los guarda en
   * biometric.Template y marca el enrollment Completed.
   *
   * Acepta varias muestras en un solo enrollment (registro guiado, Nivel 2).
   * Antes era una foto por enrollment, lo que obligaba a crear un enrollment
   * nuevo por cada captura para darle a una persona una galería variada.
   *
   * `poseSteps`, si viene, tiene que alinear 1 a 1 con `sampleBuffers`: cada
   * muestra se valida además contra la pose que se le pidió.
   *
   * Todo o nada: si una muestra falla, no se guarda ninguna. Un enrollment a
   * medias dejaría a la persona con una galería incompleta y el enrollment
   * consumido.
   */
  async capture(id: number, sampleBuffers: Buffer[], poseSteps?: FacePoseStep[]): Promise<EnrollmentEntity> {
    const enrollment = await this.findOne(id);

    const provider = this.providersByModality[enrollment.modality as SupportedModality];
    if (!provider) {
      throw new BadRequestException(`Modalidad no soportada: ${enrollment.modality}.`);
    }
    if (enrollment.status !== 'Pending') {
      throw new BadRequestException(`El enrollment ya está en estado ${enrollment.status}.`);
    }
    if (sampleBuffers.length === 0) {
      throw new BadRequestException('No se recibió ninguna muestra.');
    }
    if (poseSteps && poseSteps.length !== sampleBuffers.length) {
      // Nunca emparejar parcialmente: si los largos no cuadran, no se sabe
      // qué foto corresponde a qué paso.
      throw new BadRequestException('La cantidad de pasos no coincide con la cantidad de fotos.');
    }

    const descriptors: BiometricDescriptor[] = [];
    for (const [index, buffer] of sampleBuffers.entries()) {
      const poseStep = poseSteps?.[index];
      try {
        // Controles de calidad estrictos: estas muestras quedan como referencia de la persona.
        descriptors.push(await provider.extractDescriptor(buffer, { purpose: 'enrollment', poseStep }));
      } catch (err) {
        if (err instanceof BiometricDetectionError || err instanceof InvalidBiometricInputError) {
          this.auditService.annotate({
            eventType: 'BIOMETRIC_CAPTURE_REJECTED',
            targetType: 'Enrollment',
            targetId: id,
            details: {
              personId: enrollment.personId,
              modality: enrollment.modality,
              poseStep: poseStep ?? null,
              photoIndex: index,
              reason: err.message,
            },
          });
          throw new BadRequestException(poseStep ? `${err.message} (foto ${index + 1}: ${poseStep})` : err.message);
        }
        throw err;
      }
    }

    const templates = await this.templateRepository.save(
      descriptors.map((descriptor, index) =>
        this.templateRepository.create({
          personId: enrollment.personId,
          enrollmentId: enrollment.id,
          modality: enrollment.modality,
          vectorJson: JSON.stringify(descriptor.vector),
          ...templateProvenanceFields(descriptor, this.faceDetector, { poseStep: poseSteps?.[index] ?? null }),
        }),
      ),
    );

    enrollment.status = 'Completed';
    enrollment.completedAt = new Date();
    const saved = await this.enrollmentRepository.save(enrollment);
    this.auditService.annotate({
      eventType: 'BIOMETRIC_CAPTURED',
      targetType: 'Enrollment',
      targetId: id,
      details: {
        personId: enrollment.personId,
        modality: enrollment.modality,
        templates: templates.length,
        poseSteps: poseSteps ?? null,
      },
    });
    return saved;
  }
}
