import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { TemplateEntity } from './entities/template.entity';
import { templateProvenanceFields } from './template-fields';
import { BiometricDescriptor } from '../biometric-providers/biometric-provider.interface';
import type { FaceDetectorKind } from '../biometric-providers/face/face-quality';
import { AppConfig } from '../../config/configuration';
import { AuditService } from '../audit/audit.service';

/**
 * Templates adaptativos (Nivel 2): después de un ingreso reconocido con
 * holgura, guarda ese rostro como un template más de la persona.
 *
 * Para qué sirve: la galería del registro envejece. Cambia el pelo, los
 * lentes, la luz de la sala, la cámara. Aprender de los ingresos reales
 * mantiene la galería parecida a las condiciones en las que el sistema
 * efectivamente tiene que funcionar, que es justo lo que el registro (tres
 * fotos tomadas en diez segundos) no puede cubrir.
 *
 * Por qué está lleno de topes: una galería que se mueve sola es también la
 * forma clásica de envenenar un sistema biométrico — se lo empuja de a poco
 * hacia otra cara. Cada criterio de `evaluate()` es una barrera distinta, y
 * la más importante es el ANCLA: todo candidato tiene que seguir pareciéndose
 * a los templates del registro original, que nunca se generan solos y nunca
 * se revocan automáticamente. Sin ancla, cada template engendra el
 * siguiente y la galería deriva sin techo.
 *
 * Nunca hace fallar un ingreso: quien lo llama envuelve la llamada en
 * try/catch y acá no se lanza nada hacia afuera.
 */
@Injectable()
export class AdaptiveTemplateService {
  private readonly logger = new Logger(AdaptiveTemplateService.name);
  private readonly config: AppConfig['biometrics']['adaptive'];
  private readonly faceDetector: FaceDetectorKind;

  constructor(
    @InjectRepository(TemplateEntity)
    private readonly templateRepository: Repository<TemplateEntity>,
    configService: ConfigService<AppConfig, true>,
    private readonly auditService: AuditService,
  ) {
    const biometrics = configService.get<AppConfig['biometrics']>('biometrics');
    this.config = biometrics.adaptive;
    this.faceDetector = biometrics.faceDetector;
  }

  /**
   * Evalúa un ingreso concedido y, si pasa todos los topes, guarda el
   * descriptor como template adaptativo.
   *
   * En modo `shadow` hace toda la evaluación y registra qué habría hecho,
   * **sin escribir nada** — sirve para mirar datos reales antes de dejar que
   * el sistema toque biometría solo.
   */
  async maybeAdapt(input: AdaptiveCandidate): Promise<void> {
    if (this.config.mode === 'off') return;

    const decision = await this.evaluate(input);
    if (!decision.accepted) {
      this.logger.debug(`Adaptativo descartado (persona ${input.personId}): ${decision.reason}`);
      return;
    }

    if (this.config.mode === 'shadow') {
      await this.auditService.record({
        eventType: 'BIOMETRIC_TEMPLATE_ADAPTIVE_CANDIDATE',
        actorType: 'SYSTEM',
        sourceIp: this.auditService.currentSourceIp(),
        correlationId: this.auditService.currentCorrelationId(),
        targetType: 'Person',
        targetId: input.personId,
        details: this.decisionDetails(input, decision),
      });
      return;
    }

    const evictedTemplateId = await this.enforceCap(input.personId);

    const template = await this.templateRepository.save(
      this.templateRepository.create({
        personId: input.personId,
        enrollmentId: input.enrollmentId,
        modality: 'Face',
        vectorJson: JSON.stringify(input.descriptor.vector),
        sourceAccessLogId: input.accessLogId,
        sourceDistance: decision.probeDistance,
        ...templateProvenanceFields(input.descriptor, this.faceDetector, { source: 'ADAPTIVE' }),
      }),
    );

    // `record()` y no `annotate()`: annotate escribe UNA fila por request, así
    // que pisaría el KIOSK_CHECKIN_GRANTED del mismo ingreso. El correlation
    // id deja las dos filas enlazadas en el panel de auditoría.
    await this.auditService.record({
      eventType: 'BIOMETRIC_TEMPLATE_ADAPTED',
      actorType: 'SYSTEM',
      sourceIp: this.auditService.currentSourceIp(),
      correlationId: this.auditService.currentCorrelationId(),
      targetType: 'Person',
      targetId: input.personId,
      details: { ...this.decisionDetails(input, decision), templateId: template.id, evictedTemplateId },
    });
  }

  /** Suma un uso al template que ganó el match. Best-effort: nunca rompe el ingreso. */
  async recordTemplateUse(templateId: number | null | undefined): Promise<void> {
    if (!templateId) return;
    try {
      await this.templateRepository.increment({ id: templateId }, 'matchCount', 1);
      await this.templateRepository.update(templateId, { lastMatchedAt: new Date() });
    } catch (err) {
      this.logger.warn(`No se pudo contabilizar el uso del template ${templateId}: ${describe(err)}`);
    }
  }

  private async evaluate(input: AdaptiveCandidate): Promise<AdaptiveDecision> {
    const { detail, descriptor } = input;
    const probeDistance = detail.perProbeDistances[detail.bestProbeIndex];

    // 1) La muestra tiene que servir como referencia, no solo para reconocer.
    if (!descriptor.quality?.meetsEnrollmentProfile) {
      return reject('la foto no alcanza calidad de registro', probeDistance);
    }

    // 2) Banda de distancia: ni tan cerca que no aporte nada nuevo, ni tan
    //    lejos que el reconocimiento haya sido ajustado.
    if (probeDistance < this.config.minDistance) {
      return reject('demasiado parecido a un template que ya existe', probeDistance);
    }
    if (probeDistance > this.config.maxDistance) {
      return reject('el reconocimiento no fue lo bastante holgado', probeDistance);
    }

    // 3) Margen contra la segunda persona, mucho más duro que el de identificar.
    if (detail.runnerUpDistance !== null && detail.runnerUpDistance - probeDistance < this.config.minMargin) {
      return reject('hay otra persona demasiado cerca', probeDistance);
    }

    // 4) ANCLA: sigue pareciéndose al registro original. Es lo que impide la deriva.
    if (detail.anchorDistance === null) {
      return reject('la persona no tiene templates de registro para anclar', probeDistance);
    }
    if (detail.anchorDistance > this.config.anchorMaxDistance) {
      return reject('se alejó demasiado del registro original', probeDistance);
    }

    // 5) Varios frames del mismo intento coinciden por separado: una sola foto
    //    afortunada (o adversarial) no alcanza.
    const matchingFrames = detail.perProbeDistances.filter((distance) => distance <= this.config.maxDistance).length;
    if (matchingFrames < this.config.minFrames) {
      return reject(`solo ${matchingFrames} frame(s) coincidieron`, probeDistance);
    }

    const active = await this.templateRepository.find({
      where: { personId: input.personId, modality: 'Face', revokedAt: IsNull() },
      select: { id: true, source: true, detector: true, createdAt: true },
    });

    // 6) Base de registro suficiente: no se adapta a alguien apenas enrolado.
    const enrollmentTemplates = active.filter((template) => template.source === 'ENROLLMENT');
    if (enrollmentTemplates.length < this.config.minEnrollmentTemplates) {
      return reject('la persona tiene pocos templates de registro', probeDistance);
    }

    // 7) No mezclar detectores en una misma galería: cambiar de detector
    //    corre las distancias ~0.15-0.2 y ensuciaría todas las comparaciones.
    if (enrollmentTemplates.some((template) => template.detector && template.detector !== this.faceDetector)) {
      return reject('el registro se hizo con otro detector (hay que reenrolar)', probeDistance);
    }

    // 8) Caudal: como máximo N por día, para acotar la velocidad de la deriva.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const todayCount = await this.templateRepository.count({
      where: { personId: input.personId, source: 'ADAPTIVE', revokedAt: IsNull(), createdAt: MoreThan(since) },
    });
    if (todayCount >= this.config.maxPerDay) {
      return reject('ya se adaptó un template en las últimas 24 h', probeDistance);
    }

    return { accepted: true, probeDistance };
  }

  /**
   * Si la galería adaptativa está llena, revoca la menos útil para hacer
   * lugar. **Nunca toca los templates del registro original**: en el peor
   * caso la persona vuelve a reconocerse solo con su galería original, que es
   * el comportamiento previo al Nivel 2.
   */
  private async enforceCap(personId: number): Promise<number | null> {
    const adaptive = await this.templateRepository.find({
      where: { personId, source: 'ADAPTIVE', modality: 'Face', revokedAt: IsNull() },
      order: { matchCount: 'ASC', createdAt: 'ASC' },
    });
    if (adaptive.length < this.config.maxPerPerson) return null;

    // El menos usado y, a igualdad, el más viejo.
    const victim = adaptive[0];
    await this.templateRepository.update(victim.id, {
      revokedAt: new Date(),
      revokedByUserId: null,
      revokedReason: 'Reemplazado por un template adaptativo más reciente',
    });
    await this.auditService.record({
      eventType: 'BIOMETRIC_TEMPLATE_EVICTED',
      actorType: 'SYSTEM',
      sourceIp: this.auditService.currentSourceIp(),
      correlationId: this.auditService.currentCorrelationId(),
      targetType: 'Person',
      targetId: personId,
      details: { templateId: victim.id, matchCount: victim.matchCount, activeAdaptive: adaptive.length },
    });
    return victim.id;
  }

  private decisionDetails(input: AdaptiveCandidate, decision: AdaptiveDecision): Record<string, unknown> {
    return {
      distance: round(decision.probeDistance),
      runnerUpDistance: round(input.detail.runnerUpDistance),
      anchorDistance: round(input.detail.anchorDistance),
      frames: input.detail.perProbeDistances.length,
      accessLogId: input.accessLogId,
      detector: this.faceDetector,
    };
  }
}

export interface AdaptiveCandidate {
  personId: number;
  /** Enrollment al que se cuelga el template nuevo (el del registro de la persona). */
  enrollmentId: number;
  accessLogId: number | null;
  /** Descriptor del frame que ganó el match. */
  descriptor: BiometricDescriptor;
  detail: {
    runnerUpDistance: number | null;
    bestProbeIndex: number;
    perProbeDistances: number[];
    anchorDistance: number | null;
  };
}

type AdaptiveDecision = { accepted: true; probeDistance: number } | { accepted: false; reason: string; probeDistance: number };

function reject(reason: string, probeDistance: number): AdaptiveDecision {
  return { accepted: false, reason, probeDistance };
}

function round(value: number | null): number | null {
  return value === null ? null : Number(value.toFixed(4));
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
