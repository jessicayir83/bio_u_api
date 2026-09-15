import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PersonRegistrationEntity, RegistrationChannel, RegistrationStatus } from './entities/person-registration.entity';
import {
  IDENTIFICATION_TYPES,
  IdentificationType,
  findIdentificationProblem,
  normalizeIdentificationNumber,
} from './identification';
import { AuditService } from '../audit/audit.service';

export interface ResolvedIdentification {
  identificationType: IdentificationType;
  /** Número normalizado: es lo que se guarda y se compara. */
  nationalId: string;
}

export interface RegistrationAttempt {
  channel: RegistrationChannel;
  status: RegistrationStatus;
  identification: ResolvedIdentification;
  personId?: number | null;
  createdByUserId?: number | null;
  detail?: string | null;
}

/** Violación de UNIQUE/PRIMARY KEY en SQL Server (carrera entre dos registros simultáneos). */
export function isUniqueViolation(err: unknown): boolean {
  const number = (err as { driverError?: { number?: number }; number?: number })?.driverError?.number
    ?? (err as { number?: number })?.number;
  return number === 2627 || number === 2601;
}

/**
 * Normalización/validación de la identificación y bitácora de intentos de
 * registro, compartidas por el panel (PersonsService) y el kiosco.
 */
@Injectable()
export class PersonRegistrationService {
  private readonly logger = new Logger(PersonRegistrationService.name);

  constructor(
    @InjectRepository(PersonRegistrationEntity)
    private readonly registrationRepository: Repository<PersonRegistrationEntity>,
    private readonly auditService: AuditService,
  ) {}

  /** Normaliza y valida; 400 con un mensaje para la persona si el número no corresponde al tipo. */
  resolveIdentification(type: string, rawNumber: string): ResolvedIdentification {
    if (!(IDENTIFICATION_TYPES as readonly string[]).includes(type)) {
      throw new BadRequestException('Seleccioná un tipo de identificación válido.');
    }
    const identificationType = type as IdentificationType;
    const nationalId = normalizeIdentificationNumber(identificationType, rawNumber ?? '');
    const problem = findIdentificationProblem(identificationType, nationalId);
    if (problem) {
      throw new BadRequestException(problem);
    }
    return { identificationType, nationalId };
  }

  /** Registra el intento. Nunca rompe la operación si falla (ej. script 08 sin ejecutar). */
  async record(attempt: RegistrationAttempt): Promise<void> {
    try {
      await this.registrationRepository.insert({
        occurredAt: new Date(),
        channel: attempt.channel,
        status: attempt.status,
        identificationType: attempt.identification.identificationType,
        identificationNumber: attempt.identification.nationalId,
        personId: attempt.personId ?? null,
        sourceIp: this.auditService.currentSourceIp(),
        createdByUserId: attempt.createdByUserId ?? null,
        detail: attempt.detail ? attempt.detail.slice(0, 400) : null,
      });
    } catch (err) {
      this.logger.error(
        `No se pudo guardar el intento de registro (${err instanceof Error ? err.message : String(err)}). ` +
          '¿Se ejecutó bio_u_db/08_identification_type_registrations_scans.sql?',
      );
    }
  }

  /** Intentos de registro de la persona o con su misma identificación (incluye los de otras personas que la usaron). */
  findForPerson(personId: number, identification: ResolvedIdentification) {
    return this.registrationRepository.find({
      where: [
        { personId },
        { identificationType: identification.identificationType, identificationNumber: identification.nationalId },
      ],
      order: { occurredAt: 'DESC' },
      take: 100,
    });
  }
}
