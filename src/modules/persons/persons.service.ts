import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { BiometricPersonEntity } from './entities/biometric-person.entity';
import { PersonIdentifierEntity } from './entities/person-identifier.entity';
import { CreatePersonDto } from './dto/create-person.dto';
import { UpdatePersonDto } from './dto/update-person.dto';
import { CreatePersonIdentifierDto } from './dto/create-person-identifier.dto';
import { AuditService } from '../audit/audit.service';
import { PersonRegistrationService, isUniqueViolation } from './person-registration.service';
import { AccessLogEntity } from '../kiosk/entities/access-log.entity';

@Injectable()
export class PersonsService {
  constructor(
    @InjectRepository(BiometricPersonEntity)
    private readonly personRepository: Repository<BiometricPersonEntity>,
    @InjectRepository(PersonIdentifierEntity)
    private readonly identifierRepository: Repository<PersonIdentifierEntity>,
    private readonly auditService: AuditService,
    private readonly registrationService: PersonRegistrationService,
    @InjectRepository(AccessLogEntity)
    private readonly accessLogRepository: Repository<AccessLogEntity>,
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
