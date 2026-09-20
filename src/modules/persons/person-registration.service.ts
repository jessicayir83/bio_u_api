import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { PersonRegistrationEntity, RegistrationChannel, RegistrationStatus } from './entities/person-registration.entity';
import { BiometricPersonEntity } from './entities/biometric-person.entity';
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
    @InjectRepository(BiometricPersonEntity)
    private readonly personRepository: Repository<BiometricPersonEntity>,
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

  /**
   * Busca una persona con el MISMO número pero OTRO tipo de identificación.
   *
   * Desde el script 08 la unicidad es por (tipo + número), así que "604690940"
   * como CEDULA y como OTRO conviven sin chocar. A veces es legítimo (la misma
   * persona con cédula y DIMEX), pero también es la forma de esquivar la
   * unicidad usando el número de otro con un tipo distinto — y en la práctica
   * es la causa más común de terminar con dos fichas de la misma persona.
   *
   * Por eso no se decide acá qué hacer: se devuelve el hallazgo y cada
   * superficie resuelve (el panel avisa al operador, el kiosco no revela nada).
   */
  async findSameNumberOtherType(identification: ResolvedIdentification): Promise<BiometricPersonEntity | null> {
    return this.personRepository.findOne({
      where: {
        nationalId: identification.nationalId,
        identificationType: Not(identification.identificationType),
      },
    });
  }

  /**
   * Deja la alerta SEV2 del número reusado. Solo ids y el TIPO de
   * identificación: nunca el número ni el nombre de nadie.
   */
  annotateNumberReused(params: {
    identification: ResolvedIdentification;
    existingPersonId: number;
    existingType: string;
    channel: RegistrationChannel;
  }): void {
    this.auditService.annotate({
      eventType: 'SECURITY_IDENTIFICATION_NUMBER_REUSED',
      targetType: 'Person',
      targetId: params.existingPersonId,
      details: {
        channel: params.channel,
        tipoIntentado: params.identification.identificationType,
        tipoExistente: params.existingType,
        existingPersonId: params.existingPersonId,
      },
    });
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
