import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Like, Repository } from 'typeorm';
import { BiometricPersonEntity } from './entities/biometric-person.entity';
import { PersonIdentifierEntity } from './entities/person-identifier.entity';
import { PersonRegistrationEntity } from './entities/person-registration.entity';
import { PersonConsentEntity } from './entities/person-consent.entity';
import { PersonConsentService } from './person-consent.service';
// Solo las CLASES de entidad, para poder borrarlas en la transacción del
// purgado. No se importa `EnrollmentModule` (importaría este módulo de vuelta
// y haría un ciclo de DI): una clase de entidad no crea dependencia de DI.
import { TemplateEntity } from '../enrollment/entities/template.entity';
import { EnrollmentEntity } from '../enrollment/entities/enrollment.entity';
import { CreatePersonDto } from './dto/create-person.dto';
import { UpdatePersonDto } from './dto/update-person.dto';
import { CreatePersonIdentifierDto } from './dto/create-person-identifier.dto';
import { AuditService } from '../audit/audit.service';
import { PersonRegistrationService, isUniqueViolation } from './person-registration.service';
import { IDENTIFICATION_TYPE_LABELS, type IdentificationType } from './identification';
import { AccessLogEntity } from '../kiosk/entities/access-log.entity';

/** La columna es `nvarchar`, así que el tipo puede no estar en el catálogo (datos viejos). */
function identificationTypeLabel(type: string): string {
  return IDENTIFICATION_TYPE_LABELS[type as IdentificationType] ?? type;
}

/** Qué se borró al purgar una persona (para confirmarlo en pantalla y auditarlo). */
export interface PersonPurgeResult {
  personId: number;
  templates: number;
  scans: number;
  enrollments: number;
  identifiers: number;
  registrations: number;
  consents: number;
}

@Injectable()
export class PersonsService {
  constructor(
    @InjectRepository(BiometricPersonEntity)
    private readonly personRepository: Repository<BiometricPersonEntity>,
    @InjectRepository(PersonIdentifierEntity)
    private readonly identifierRepository: Repository<PersonIdentifierEntity>,
    private readonly auditService: AuditService,
    private readonly registrationService: PersonRegistrationService,
    private readonly consentService: PersonConsentService,
    @InjectRepository(AccessLogEntity)
    private readonly accessLogRepository: Repository<AccessLogEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreatePersonDto, createdByUserId: number): Promise<BiometricPersonEntity> {
    const identification = this.registrationService.resolveIdentification(dto.identificationType, dto.nationalId);

    const existing = await this.personRepository.findOne({ where: identification });
    if (existing) {
      await this.registrationService.record({
        channel: 'PANEL',
        status: 'DUPLICATE_ID',
        identification,
        personId: existing.id,
        createdByUserId,
        detail: 'La identificación ya pertenece a una persona registrada.',
      });
      throw new ConflictException('Ya existe una persona registrada con ese tipo y número de identificación.');
    }

    // El mismo número bajo OTRO tipo: puede ser legítimo (la misma persona con
    // cédula y DIMEX) o puede ser alguien esquivando la unicidad. Se avisa al
    // operador y se deja alerta; si confirma, sigue.
    const otherType = await this.registrationService.findSameNumberOtherType(identification);
    if (otherType) {
      this.registrationService.annotateNumberReused({
        identification,
        existingPersonId: otherType.id,
        existingType: otherType.identificationType,
        channel: 'PANEL',
      });
      if (!dto.allowDuplicateNumber) {
        await this.registrationService.record({
          channel: 'PANEL',
          status: 'DUPLICATE_ID',
          identification,
          personId: otherType.id,
          createdByUserId,
          detail: `El número ya existe con el tipo ${otherType.identificationType}.`,
        });
        throw new ConflictException({
          // `code` estable para que el panel distinga este caso del duplicado
          // exacto y pueda ofrecer confirmar, en vez de ser un callejón sin salida.
          code: 'IDENTIFICATION_NUMBER_REUSED',
          existingIdentificationType: otherType.identificationType,
          message:
            `Ese número ya está registrado como ${identificationTypeLabel(otherType.identificationType)}. ` +
            'Si de verdad es otra persona (o la misma con dos documentos), confirmá para registrarla igual.',
        });
      }
    }

    let person: BiometricPersonEntity;
    try {
      person = await this.personRepository.save(
        this.personRepository.create({
          identificationType: identification.identificationType,
          nationalId: identification.nationalId,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          dateOfBirth: dto.dateOfBirth ?? null,
          createdByUserId,
        }),
      );
    } catch (err) {
      // Dos registros simultáneos con la misma identificación: el índice único frena al segundo.
      if (isUniqueViolation(err)) {
        throw new ConflictException('Ya existe una persona registrada con ese tipo y número de identificación.');
      }
      throw err;
    }

    // El operador confirmó en pantalla que la persona dio su consentimiento informado.
    await this.consentService.recordBiometricConsent({
      personId: person.id,
      policyVersion: dto.policyVersion,
      channel: 'PANEL',
      recordedByUserId: createdByUserId,
    });

    await this.registrationService.record({
      channel: 'PANEL',
      status: 'SUCCESS',
      identification,
      personId: person.id,
      createdByUserId,
    });
    // Nunca valores de datos personales en la auditoría: solo el id del registro.
    this.auditService.annotate({
      eventType: 'PERSON_CREATED',
      targetType: 'Person',
      targetId: person.id,
      details: { identificationType: identification.identificationType },
    });
    return person;
  }

  async findAll(search?: string): Promise<BiometricPersonEntity[]> {
    const persons = !search
      ? await this.personRepository.find({ order: { createdAt: 'DESC' } })
      : await this.personRepository.find({
          where: [
            { nationalId: Like(`%${search.trim()}%`) },
            // Los números se guardan sin guiones/espacios: "1-2345" también encuentra "12345...".
            { nationalId: Like(`%${search.replace(/[\s-]/g, '').toUpperCase()}%`) },
            { lastName: Like(`%${search.trim()}%`) },
          ],
          order: { createdAt: 'DESC' },
        });
    // El término buscado puede ser una cédula: se registra que hubo búsqueda, no su valor.
    this.auditService.annotate({ eventType: 'PERSON_LISTED', details: { searched: !!search, resultCount: persons.length } });
    return persons;
  }

  /**
   * Borrado DEFINITIVO de una persona y de todo lo suyo. A diferencia de
   * `remove()` (que es baja lógica: `isActive = false` y el registro sigue
   * ahí), esto no se puede deshacer.
   *
   * Existe para poder atender un pedido de supresión de datos: la persona
   * pidió que se borre su biometría y no alcanza con desactivarla.
   *
   * Orden obligado por las FKs (ver `bio_u_db/`):
   *   Template → AccessLog → Enrollment → PersonIdentifier →
   *   PersonRegistration → BiometricPerson
   * `Template.PersonId` y `AccessLog.PersonId` son `NO ACTION` (bloquean el
   * borrado de la persona), y desde el script 09 `Template.SourceAccessLogId`
   * apunta a `AccessLog`, así que los templates tienen que irse ANTES que los
   * escaneos. Va todo en una transacción: una persona a medio borrar es peor
   * que una sin borrar.
   *
   * Lo que NO se borra: `audit.AuditEvent`. La bitácora es append-only por
   * trigger y no tiene FK a la persona justamente para sobrevivir a esto —
   * queda el rastro de que alguien borró a la persona con id N, sin sus datos.
   */
  async purge(id: number, deletedByUserId: number): Promise<PersonPurgeResult> {
    const person = await this.findOne(id);
    const identificationType = person.identificationType;

    const deleted = await this.dataSource.transaction(async (manager) => {
      const templates = await manager.delete(TemplateEntity, { personId: id });
      const scans = await manager.delete(AccessLogEntity, { personId: id });
      const enrollments = await manager.delete(EnrollmentEntity, { personId: id });
      const identifiers = await manager.delete(PersonIdentifierEntity, { personId: id });
      const registrations = await manager.delete(PersonRegistrationEntity, { personId: id });
      const consents = await manager.delete(PersonConsentEntity, { personId: id });
      await manager.delete(BiometricPersonEntity, { id });

      return {
        templates: templates.affected ?? 0,
        scans: scans.affected ?? 0,
        enrollments: enrollments.affected ?? 0,
        identifiers: identifiers.affected ?? 0,
        registrations: registrations.affected ?? 0,
        consents: consents.affected ?? 0,
      };
    });

    // Solo ids, conteos y el TIPO de identificación: nunca el número ni el nombre.
    this.auditService.annotate({
      eventType: 'PERSON_PURGED',
      targetType: 'Person',
      targetId: id,
      details: { ...deleted, identificationType, deletedByUserId },
    });

    return { personId: id, ...deleted };
  }

  async findOne(id: number): Promise<BiometricPersonEntity> {
    const person = await this.personRepository.findOne({ where: { id }, relations: { identifiers: true } });
    if (!person) {
      throw new NotFoundException(`No existe una persona con id ${id}.`);
    }
    return person;
  }

  /** Historial de escaneos de rostro de la persona (ingresos del kiosco y verificaciones del panel). */
  async findScans(id: number) {
    await this.findOne(id);
    return this.accessLogRepository.find({
      where: { personId: id },
      order: { occurredAt: 'DESC' },
      take: 100,
    });
  }

  /** Intentos de registro de la persona o con su misma identificación. */
  async findRegistrations(id: number) {
    const person = await this.findOne(id);
    const identification = {
      identificationType: person.identificationType as 'CEDULA',
      nationalId: person.nationalId,
    };
    return this.registrationService.findForPerson(id, identification);
  }

  async update(id: number, dto: UpdatePersonDto): Promise<BiometricPersonEntity> {
    const person = await this.findOne(id);
    const changedFields = (Object.keys(dto) as Array<keyof UpdatePersonDto>).filter(
      (field) => dto[field] !== undefined && String(dto[field]) !== String(person[field] ?? ''),
    );
    const wasActive = person.isActive;
    Object.assign(person, dto);
    await this.personRepository.save(person);
    this.auditService.annotate({
      eventType: wasActive && dto.isActive === false ? 'PERSON_DEACTIVATED' : 'PERSON_UPDATED',
      targetType: 'Person',
      targetId: id,
      details: { changedFields, reactivated: !wasActive && dto.isActive === true },
    });
    return this.findOne(id);
  }

  /** Soft delete: un registro de identidad nunca se borra físicamente. */
  async deactivate(id: number): Promise<void> {
    const person = await this.findOne(id);
    person.isActive = false;
    await this.personRepository.save(person);
    this.auditService.annotate({ eventType: 'PERSON_DEACTIVATED', targetType: 'Person', targetId: id });
  }

  async addIdentifier(personId: number, dto: CreatePersonIdentifierDto): Promise<PersonIdentifierEntity> {
    await this.findOne(personId);

    const existing = await this.identifierRepository.findOne({
      where: { identifierType: dto.identifierType, identifierValue: dto.identifierValue },
    });
    if (existing) {
      throw new ConflictException('Ya existe un identificador con ese tipo y valor.');
    }

    const identifier = await this.identifierRepository.save(this.identifierRepository.create({ ...dto, personId }));
    this.auditService.annotate({
      eventType: 'PERSON_IDENTIFIER_ADDED',
      targetType: 'Person',
      targetId: personId,
      details: { identifierId: identifier.id, identifierType: dto.identifierType },
    });
    return identifier;
  }

  async removeIdentifier(personId: number, identifierId: number): Promise<void> {
    const identifier = await this.identifierRepository.findOne({ where: { id: identifierId, personId } });
    if (!identifier) {
      throw new NotFoundException(`No existe el identificador ${identifierId} para la persona ${personId}.`);
    }
    await this.identifierRepository.remove(identifier);
    this.auditService.annotate({
      eventType: 'PERSON_IDENTIFIER_REMOVED',
      targetType: 'Person',
      targetId: personId,
      details: { identifierId, identifierType: identifier.identifierType },
    });
  }
}
