import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { TemplateEntity } from './entities/template.entity';
import { AppConfig } from '../../config/configuration';
import { AuditService } from '../audit/audit.service';
import type { FaceDetectorKind } from '../biometric-providers/face/face-quality';

/**
 * Galería biométrica de una persona: qué templates tiene, de dónde salió cada
 * uno y cuáles siguen participando del reconocimiento.
 *
 * Existe porque el Nivel 2 hace que la galería cambie sola (templates
 * adaptativos). Que el sistema aprenda solo es aceptable únicamente si
 * alguien puede mirar qué aprendió y deshacerlo.
 *
 * Nunca expone el vector: la respuesta es metadatos y nada más.
 */
@Injectable()
export class TemplatesService {
  private readonly faceDetector: FaceDetectorKind;

  constructor(
    @InjectRepository(TemplateEntity)
    private readonly templateRepository: Repository<TemplateEntity>,
    configService: ConfigService<AppConfig, true>,
    private readonly auditService: AuditService,
  ) {
    this.faceDetector = configService.get<AppConfig['biometrics']>('biometrics').faceDetector;
  }

  async listByPerson(personId: number): Promise<TemplateSummary[]> {
    const templates = await this.templateRepository.find({
      where: { personId },
      order: { createdAt: 'DESC' },
    });
    this.auditService.annotate({
      eventType: 'BIOMETRIC_TEMPLATES_VIEWED',
      targetType: 'Person',
      targetId: personId,
      details: { templates: templates.length },
    });
    return templates.map((template) => this.toSummary(template));
  }

  async revoke(id: number, userId: number, reason?: string): Promise<TemplateSummary> {
    const template = await this.findOne(id);
    if (template.revokedAt) {
      throw new BadRequestException('Ese template ya estaba revocado.');
    }

    // Dejar a una persona activa sin ningún rostro la vuelve irreconocible
    // sin que nadie se entere hasta que falle su próximo ingreso.
    const remaining = await this.templateRepository.count({
      where: { personId: template.personId, modality: template.modality, revokedAt: IsNull(), id: Not(id) },
    });
    if (remaining === 0) {
      throw new ConflictException(
        'Es el último rostro registrado de esta persona: quedaría sin poder ingresar. Registrá otro antes de revocar este, o desactivá a la persona.',
      );
    }

    await this.templateRepository.update(id, {
      revokedAt: new Date(),
      revokedByUserId: userId,
      revokedReason: reason?.trim() || 'Revocado manualmente',
    });
    this.auditService.annotate({
      eventType: 'BIOMETRIC_TEMPLATE_REVOKED',
      targetType: 'Person',
      targetId: template.personId,
      details: { templateId: id, source: template.source, remainingActive: remaining },
    });
    return this.toSummary(await this.findOne(id));
  }

  async restore(id: number): Promise<TemplateSummary> {
    const template = await this.findOne(id);
    if (!template.revokedAt) {
      throw new BadRequestException('Ese template no está revocado.');
    }
    await this.templateRepository.update(id, { revokedAt: null, revokedByUserId: null, revokedReason: null });
    this.auditService.annotate({
      eventType: 'BIOMETRIC_TEMPLATE_RESTORED',
      targetType: 'Person',
      targetId: template.personId,
      details: { templateId: id, source: template.source },
    });
    return this.toSummary(await this.findOne(id));
  }

  private async findOne(id: number): Promise<TemplateEntity> {
    const template = await this.templateRepository.findOne({ where: { id } });
    if (!template) {
      throw new NotFoundException(`No existe un template con id ${id}.`);
    }
    return template;
  }

  /** Metadatos únicamente: el vector nunca sale del servidor. */
  private toSummary(template: TemplateEntity): TemplateSummary {
    return {
      id: template.id,
      personId: template.personId,
      enrollmentId: template.enrollmentId,
      modality: template.modality,
      source: template.source,
      poseStep: template.poseStep,
      detector: template.detector,
      /** El template se generó con otro detector: sus distancias no son comparables con las actuales. */
      staleDetector: template.detector !== null && template.detector !== this.faceDetector,
      detectionScore: template.detectionScore,
      yawOffset: template.yawOffset,
      sharpness: template.sharpness,
      matchCount: template.matchCount,
      lastMatchedAt: template.lastMatchedAt,
      sourceDistance: template.sourceDistance,
      sourceAccessLogId: template.sourceAccessLogId,
      revokedAt: template.revokedAt,
      revokedByUserId: template.revokedByUserId,
      revokedReason: template.revokedReason,
      createdAt: template.createdAt,
    };
  }
}

export interface TemplateSummary {
  id: number;
  personId: number;
  enrollmentId: number;
  modality: string;
  source: string;
  poseStep: string | null;
  detector: string | null;
  staleDetector: boolean;
  detectionScore: number | null;
  yawOffset: number | null;
  sharpness: number | null;
  matchCount: number;
  lastMatchedAt: Date | null;
  sourceDistance: number | null;
  sourceAccessLogId: number | null;
  revokedAt: Date | null;
  revokedByUserId: number | null;
  revokedReason: string | null;
  createdAt: Date;
}
