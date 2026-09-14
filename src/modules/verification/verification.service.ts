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

    const template = await this.templateRepository.findOne({
      where: { personId, modality },
      order: { createdAt: 'DESC' },
    });
    if (!template) {
      throw new NotFoundException(`La persona no tiene un template ${modality} registrado.`);
    }

    let probe: BiometricDescriptor;
    try {
      probe = await provider.extractDescriptor(sampleBuffer);
    } catch (err) {
      if (err instanceof BiometricDetectionError || err instanceof InvalidBiometricInputError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    const stored: BiometricDescriptor = { vector: JSON.parse(template.vectorJson) };
    const { distance, isMatch } = provider.compare(stored, probe);

    return { personId, modality, isMatch, distance, threshold: this.thresholdsByModality[modality] };
  }

  /**
   * Identificación 1:N — "¿quién es esta persona?", sin conocer su id de
   * antemano (lo usa el kiosco). Compara contra todos los templates de la
   * modalidad y se queda con la menor distancia.
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
  async identify(modality: BiometricModality, sampleBuffer: Buffer): Promise<BiometricIdentificationResult> {
    const provider = this.providersByModality[modality];

    let probe: BiometricDescriptor;
    try {
      probe = await provider.extractDescriptor(sampleBuffer);
    } catch (err) {
      if (err instanceof BiometricDetectionError || err instanceof InvalidBiometricInputError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    const templates = await this.templateRepository.find({
      where: { modality },
      relations: { person: true },
    });

    const candidates = templates
      .filter((template) => template.person?.isActive)
      .map((template) => ({
        person: template.person,
        distance: provider.compare({ vector: JSON.parse(template.vectorJson) }, probe).distance,
      }))
      .sort((a, b) => a.distance - b.distance);

    if (candidates.length === 0) {
      return { matched: false };
    }

    const best = candidates[0];
    if (best.distance > this.thresholdsByModality[modality]) {
      return { matched: false };
    }

    // El segundo mejor candidato de OTRA persona (varios templates de la
    // misma persona no compiten entre sí).
    const runnerUp = candidates.find((candidate) => candidate.person.id !== best.person.id);
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
