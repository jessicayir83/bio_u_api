import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EnrollmentEntity } from './entities/enrollment.entity';
import { TemplateEntity } from './entities/template.entity';
import { BiometricPersonEntity } from '../persons/entities/biometric-person.entity';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { UpdateEnrollmentStatusDto } from './dto/update-enrollment-status.dto';
import {
  BiometricDetectionError,
  BiometricProvider,
  FACE_PROVIDER,
  FINGERPRINT_PROVIDER,
  InvalidBiometricInputError,
} from '../biometric-providers/biometric-provider.interface';
import { AuditService } from '../audit/audit.service';

const SUPPORTED_MODALITIES = ['Face', 'Fingerprint'] as const;
type SupportedModality = (typeof SUPPORTED_MODALITIES)[number];

@Injectable()
export class EnrollmentService {
  private readonly providersByModality: Record<SupportedModality, BiometricProvider>;

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
  ) {
    this.providersByModality = { Face: faceProvider, Fingerprint: fingerprintProvider };
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
   * Captura la biometría de un enrollment Pending: extrae el descriptor
   * (con el provider de la modalidad del enrollment), lo guarda en
   * biometric.Template y marca el enrollment Completed.
   */
  async capture(id: number, sampleBuffer: Buffer): Promise<EnrollmentEntity> {
    const enrollment = await this.findOne(id);

    const provider = this.providersByModality[enrollment.modality as SupportedModality];
    if (!provider) {
      throw new BadRequestException(`Modalidad no soportada: ${enrollment.modality}.`);
    }
    if (enrollment.status !== 'Pending') {
      throw new BadRequestException(`El enrollment ya está en estado ${enrollment.status}.`);
    }

    let descriptor;
    try {
      // Controles de calidad estrictos: esta muestra queda como referencia de la persona.
      descriptor = await provider.extractDescriptor(sampleBuffer, { purpose: 'enrollment' });
    } catch (err) {
      if (err instanceof BiometricDetectionError || err instanceof InvalidBiometricInputError) {
        this.auditService.annotate({
          eventType: 'BIOMETRIC_CAPTURE_REJECTED',
          targetType: 'Enrollment',
          targetId: id,
          details: { personId: enrollment.personId, modality: enrollment.modality, reason: err.message },
        });
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    const template = this.templateRepository.create({
      personId: enrollment.personId,
      enrollmentId: enrollment.id,
      modality: enrollment.modality,
      vectorJson: JSON.stringify(descriptor.vector),
    });
    await this.templateRepository.save(template);

    enrollment.status = 'Completed';
    enrollment.completedAt = new Date();
    const saved = await this.enrollmentRepository.save(enrollment);
    this.auditService.annotate({
      eventType: 'BIOMETRIC_CAPTURED',
      targetType: 'Enrollment',
      targetId: id,
      details: { personId: enrollment.personId, modality: enrollment.modality, templateId: template.id },
    });
    return saved;
  }
}
