import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { IsNull, Repository } from 'typeorm';
import { BiometricPersonEntity } from '../persons/entities/biometric-person.entity';
import { TemplateEntity, type TemplateSource } from '../enrollment/entities/template.entity';
import {
  BiometricDescriptor,
  BiometricDetectionError,
  BiometricProvider,
  FACE_PROVIDER,
  FINGERPRINT_PROVIDER,
  InvalidBiometricInputError,
} from '../biometric-providers/biometric-provider.interface';
import type { FacePoseStep } from '../biometric-providers/face/face-quality';
import { AppConfig } from '../../config/configuration';
import { AuditService } from '../audit/audit.service';
import { AccessLogEntity, ScanStatus } from '../kiosk/entities/access-log.entity';

const SUPPORTED_MODALITIES = ['Face', 'Fingerprint'] as const;
export type BiometricModality = (typeof SUPPORTED_MODALITIES)[number];

export interface BiometricVerificationResult {
  personId: number;
  modality: BiometricModality;
  isMatch: boolean;
  distance: number;
  threshold: number;
}

export interface IdentifiedPerson {
  id: number;
  identificationType: string;
  nationalId: string;
  firstName: string;
  lastName: string;
}

export interface BiometricIdentificationResult {
  matched: boolean;
  person?: IdentifiedPerson;
  distance?: number;
  /** true cuando el mejor match no se distingue lo suficiente del segundo (ver FACE_IDENTIFY_MARGIN). */
  ambiguous?: boolean;
  /**
   * Detalle interno del match. **Nunca sale al cliente**: el kiosco arma su
   * respuesta pública con `toPublicIdentifyResponse`. Lo consume la
   * adaptación de templates, que necesita saber con cuánta holgura ganó el
   * match antes de aprender de él.
   */
  detail?: BiometricIdentificationDetail;
}

/** Vector descifrado de un template, con lo mínimo para saber de dónde salió. */
interface TemplateVector {
  templateId: number;
  source: TemplateSource;
  vector: number[];
}

export interface BiometricIdentificationDetail {
  /** Distancia de la segunda persona; `null` si no hay otra en la base. */
  runnerUpDistance: number | null;
  /** Template que quedó más cerca (para contabilizar su uso). */
  bestTemplateId: number | null;
  /** Índice del probe que ganó, dentro de los descriptores recibidos. */
  bestProbeIndex: number;
  /** Distancia de cada probe a la persona ganadora (para exigir varios frames coincidentes). */
  perProbeDistances: number[];
  /** Menor distancia contra templates del registro ORIGINAL: el ancla anti-deriva. */
  anchorDistance: number | null;
}

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);
  private readonly providersByModality: Record<BiometricModality, BiometricProvider>;
  private readonly thresholdsByModality: Record<BiometricModality, number>;
  private readonly identifyMargin: number;

  constructor(
    @InjectRepository(BiometricPersonEntity)
    private readonly personRepository: Repository<BiometricPersonEntity>,
    @InjectRepository(TemplateEntity)
    private readonly templateRepository: Repository<TemplateEntity>,
    @InjectRepository(AccessLogEntity)
    private readonly accessLogRepository: Repository<AccessLogEntity>,
    @Inject(FACE_PROVIDER)
    faceProvider: BiometricProvider,
    @Inject(FINGERPRINT_PROVIDER)
    fingerprintProvider: BiometricProvider,
    configService: ConfigService,
    private readonly auditService: AuditService,
  ) {
    const biometrics = configService.get<AppConfig['biometrics']>('biometrics')!;
    this.providersByModality = { Face: faceProvider, Fingerprint: fingerprintProvider };
    this.thresholdsByModality = {
      Face: biometrics.faceMatchThreshold,
      // El mock de huella solo reporta igual/distinto (ver MockFingerprintProvider) — no hay umbral real que calibrar.
      Fingerprint: 0,
    };
    this.identifyMargin = biometrics.faceIdentifyMargin;
  }

  async verify(modality: BiometricModality, personId: number, sampleBuffer: Buffer): Promise<BiometricVerificationResult> {
    const provider = this.providersByModality[modality];

    const person = await this.personRepository.findOne({ where: { id: personId } });
    if (!person) {
      throw new NotFoundException(`No existe una persona con id ${personId}.`);
    }

    // Contra TODOS los templates de la persona, quedándose con el más
    // cercano: una persona registrada con varias fotos (ángulos/gestos
    // distintos) se reconoce mejor que comparando solo contra la última.
    // Sin los revocados, igual que la identificación 1:N.
    const templates = await this.templateRepository.find({ where: { personId, modality, revokedAt: IsNull() } });
    if (templates.length === 0) {
      throw new NotFoundException(`La persona no tiene un template ${modality} registrado.`);
    }

    let probe: BiometricDescriptor;
    try {
      probe = await provider.extractDescriptor(sampleBuffer, { purpose: 'probe' });
    } catch (err) {
      if (err instanceof BiometricDetectionError || err instanceof InvalidBiometricInputError) {
        this.auditService.annotate({
          eventType: 'VERIFICATION_REJECTED',
          targetType: 'Person',
          targetId: personId,
          details: { modality, reason: err.message },
        });
        await this.recordPanelScan(personId, modality, 'REJECTED', null);
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    const { distance, isMatch } = templates
      .map((template) => provider.compare({ vector: JSON.parse(template.vectorJson) }, probe))
      .reduce((best, result) => (result.distance < best.distance ? result : best));

    const threshold = this.thresholdsByModality[modality];
    await this.recordPanelScan(personId, modality, isMatch ? 'MATCH' : 'NO_MATCH', distance);
    this.auditService.annotate({
      eventType: isMatch ? 'VERIFICATION_MATCH' : 'VERIFICATION_NO_MATCH',
      targetType: 'Person',
      targetId: personId,
      details: { modality, distance, threshold, templatesCompared: templates.length },
    });
    return { personId, modality, isMatch, distance, threshold };
  }

  /** Verificación 1:1 del panel → historial de escaneos de la persona (biometric.AccessLog). */
  private async recordPanelScan(personId: number, modality: BiometricModality, status: ScanStatus, distance: number | null) {
    try {
      await this.accessLogRepository.insert({
        personId,
        modality,
        granted: status === 'MATCH',
        status,
        channel: 'PANEL_VERIFICATION',
        distance,
        sourceIp: this.auditService.currentSourceIp(),
      });
    } catch (err) {
      // Sin el script 08 (columnas Status/Channel) no se rompe la verificación.
      this.logger.error(`No se pudo guardar el escaneo en el historial: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Extrae descriptores de varias capturas, descartando las inválidas o de
   * mala calidad (no corta en la primera). `firstProblem` trae el motivo de
   * la primera descartada, para mostrárselo a la persona si no alcanza.
   */
  async extractValidDescriptors(
    modality: BiometricModality,
    sampleBuffers: Buffer[],
    purpose: 'enrollment' | 'probe',
    poseSteps?: FacePoseStep[],
  ): Promise<{ descriptors: BiometricDescriptor[]; validPoseSteps: (FacePoseStep | null)[]; firstProblem?: string }> {
    const provider = this.providersByModality[modality];
    const descriptors: BiometricDescriptor[] = [];
    // Alineado 1 a 1 con `descriptors`: qué paso de pose sobrevivió, para
    // poder guardarlo con su template (las descartadas rompen el índice).
    const validPoseSteps: (FacePoseStep | null)[] = [];
    let firstProblem: string | undefined;

    for (const [index, buffer] of sampleBuffers.entries()) {
      const poseStep = poseSteps?.[index];
      try {
        descriptors.push(await provider.extractDescriptor(buffer, { purpose, poseStep }));
        validPoseSteps.push(poseStep ?? null);
      } catch (err) {
        if (err instanceof BiometricDetectionError || err instanceof InvalidBiometricInputError) {
          firstProblem ??= poseStep ? `${err.message} (${poseStep})` : err.message;
          continue;
        }
        throw err;
      }
    }

    return { descriptors, validPoseSteps, firstProblem };
  }

  /**
   * Identificación 1:N a partir de una o varias capturas de la misma
   * persona (ej. frames seguidos de la cámara del kiosco). Las capturas de
   * mala calidad se descartan; si no queda ninguna → 400 con el motivo.
   */
  async identify(modality: BiometricModality, sampleBuffers: Buffer[]): Promise<BiometricIdentificationResult> {
    const { descriptors, firstProblem } = await this.extractValidDescriptors(modality, sampleBuffers, 'probe');
    if (descriptors.length === 0) {
      throw new BadRequestException(firstProblem ?? 'No se recibió ninguna muestra.');
    }
    return this.identifyDescriptors(modality, descriptors);
  }

  /**
   * Identificación 1:N — "¿quién es esta persona?", sin conocer su id de
   * antemano (lo usa el kiosco).
   *
   * Distancia de cada persona = para cada probe, su template más cercano;
   * luego el promedio entre probes. Con un solo probe equivale a "menor
   * distancia"; con varios, un frame malo (parpadeo, movimiento) pesa menos
   * que en una sola foto.
   *
   * Además del umbral normal, exige un margen mínimo entre el mejor y el
   * segundo mejor candidato: si dos personas distintas quedan casi igual
   * de cerca, el resultado es ambiguo y NO se identifica a nadie (es
   * preferible pedir otro intento que confundir a dos personas).
   *
   * Nota de escala: compara en memoria contra todos los templates, lo
   * cual es correcto para cientos/miles de personas. Con decenas de miles
   * habría que indexar vectores.
   */
  async identifyDescriptors(modality: BiometricModality, probes: BiometricDescriptor[]): Promise<BiometricIdentificationResult> {
    const provider = this.providersByModality[modality];
    if (probes.length === 0) {
      return { matched: false };
    }

    const templates = await this.templateRepository.find({
      // Los revocados (por un Admin o por el tope de adaptativos) siguen en la
      // tabla pero NO participan del reconocimiento. Ver también `verify`.
      where: { modality, revokedAt: IsNull() },
      relations: { person: true },
    });

    const vectorsByPerson = new Map<number, { person: BiometricPersonEntity; entries: TemplateVector[] }>();
    for (const template of templates) {
      if (!template.person?.isActive) continue;
      const entry = vectorsByPerson.get(template.person.id) ?? { person: template.person, entries: [] };
      entry.entries.push({
        templateId: template.id,
        source: template.source,
        vector: JSON.parse(template.vectorJson) as number[],
      });
      vectorsByPerson.set(template.person.id, entry);
    }

    const candidates = [...vectorsByPerson.values()]
      .map(({ person, entries }) => {
        // Para cada probe, su template más cercano; después el promedio entre
        // probes (un frame malo pesa menos que en una sola foto).
        const perProbe = probes.map((probe) =>
          entries.reduce(
            (closest, entry) => {
              const distance = provider.compare({ vector: entry.vector }, probe).distance;
              return distance < closest.distance ? { distance, templateId: entry.templateId } : closest;
            },
            { distance: Number.POSITIVE_INFINITY, templateId: null as number | null },
          ),
        );
        const distance = perProbe.reduce((sum, value) => sum + value.distance, 0) / perProbe.length;
        return { person, entries, perProbe, distance };
      })
      .sort((a, b) => a.distance - b.distance);

    if (candidates.length === 0) {
      return { matched: false };
    }

    const best = candidates[0];
    if (best.distance > this.thresholdsByModality[modality]) {
      return { matched: false };
    }

    // Los candidatos ya están agrupados por persona: el segundo es siempre OTRA persona.
    const runnerUp = candidates[1];
    if (runnerUp && runnerUp.distance - best.distance < this.identifyMargin) {
      return { matched: false, ambiguous: true };
    }

    let bestProbeIndex = 0;
    best.perProbe.forEach((value, index) => {
      if (value.distance < best.perProbe[bestProbeIndex].distance) bestProbeIndex = index;
    });

    // Ancla anti-deriva: distancia contra los templates del registro original,
    // que son los únicos que nunca se generaron solos.
    const anchorVectors = best.entries.filter((entry) => entry.source === 'ENROLLMENT');
    const anchorDistance = anchorVectors.length
      ? Math.min(
          ...anchorVectors.map((entry) => provider.compare({ vector: entry.vector }, probes[bestProbeIndex]).distance),
        )
      : null;

    return {
      matched: true,
      distance: best.distance,
      person: {
        id: best.person.id,
        identificationType: best.person.identificationType,
        nationalId: best.person.nationalId,
        firstName: best.person.firstName,
        lastName: best.person.lastName,
      },
      detail: {
        runnerUpDistance: runnerUp?.distance ?? null,
        bestTemplateId: best.perProbe[bestProbeIndex].templateId,
        bestProbeIndex,
        perProbeDistances: best.perProbe.map((value) => value.distance),
        anchorDistance,
      },
    };
  }
}
