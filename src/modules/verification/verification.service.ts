import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { BiometricPersonEntity } from '../persons/entities/biometric-person.entity';
import { TemplateEntity } from '../enrollment/entities/template.entity';
import {
  BiometricDescriptor,
  BiometricDetectionError,
  BiometricProvider,
  FACE_PROVIDER,
  FINGERPRINT_PROVIDER,
  InvalidBiometricInputError,
} from '../biometric-providers/biometric-provider.interface';
import { AppConfig } from '../../config/configuration';

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
}

@Injectable()
export class VerificationService {
  private readonly providersByModality: Record<BiometricModality, BiometricProvider>;
  private readonly thresholdsByModality: Record<BiometricModality, number>;
  private readonly identifyMargin: number;

  constructor(
    @InjectRepository(BiometricPersonEntity)
    private readonly personRepository: Repository<BiometricPersonEntity>,
    @InjectRepository(TemplateEntity)
    private readonly templateRepository: Repository<TemplateEntity>,
    @Inject(FACE_PROVIDER)
    faceProvider: BiometricProvider,
    @Inject(FINGERPRINT_PROVIDER)
    fingerprintProvider: BiometricProvider,
    configService: ConfigService,
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
    const templates = await this.templateRepository.find({ where: { personId, modality } });
    if (templates.length === 0) {
      throw new NotFoundException(`La persona no tiene un template ${modality} registrado.`);
    }

    let probe: BiometricDescriptor;
    try {
      probe = await provider.extractDescriptor(sampleBuffer, { purpose: 'probe' });
    } catch (err) {
      if (err instanceof BiometricDetectionError || err instanceof InvalidBiometricInputError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    const { distance, isMatch } = templates
      .map((template) => provider.compare({ vector: JSON.parse(template.vectorJson) }, probe))
      .reduce((best, result) => (result.distance < best.distance ? result : best));

    return { personId, modality, isMatch, distance, threshold: this.thresholdsByModality[modality] };
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
  ): Promise<{ descriptors: BiometricDescriptor[]; firstProblem?: string }> {
    const provider = this.providersByModality[modality];
    const descriptors: BiometricDescriptor[] = [];
    let firstProblem: string | undefined;

    for (const buffer of sampleBuffers) {
      try {
        descriptors.push(await provider.extractDescriptor(buffer, { purpose }));
      } catch (err) {
        if (err instanceof BiometricDetectionError || err instanceof InvalidBiometricInputError) {
          firstProblem ??= err.message;
          continue;
        }
        throw err;
      }
    }

    return { descriptors, firstProblem };
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
      where: { modality },
      relations: { person: true },
    });

    const vectorsByPerson = new Map<number, { person: BiometricPersonEntity; vectors: number[][] }>();
    for (const template of templates) {
      if (!template.person?.isActive) continue;
      const entry = vectorsByPerson.get(template.person.id) ?? { person: template.person, vectors: [] };
      entry.vectors.push(JSON.parse(template.vectorJson));
      vectorsByPerson.set(template.person.id, entry);
    }

    const candidates = [...vectorsByPerson.values()]
      .map(({ person, vectors }) => {
        const closestPerProbe = probes.map((probe) =>
          Math.min(...vectors.map((vector) => provider.compare({ vector }, probe).distance)),
        );
        const distance = closestPerProbe.reduce((sum, value) => sum + value, 0) / closestPerProbe.length;
        return { person, distance };
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

    return {
      matched: true,
      distance: best.distance,
      person: {
        id: best.person.id,
        nationalId: best.person.nationalId,
        firstName: best.person.firstName,
        lastName: best.person.lastName,
      },
    };
  }
}
