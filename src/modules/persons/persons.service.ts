import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { BiometricPersonEntity } from './entities/biometric-person.entity';
import { PersonIdentifierEntity } from './entities/person-identifier.entity';
import { CreatePersonDto } from './dto/create-person.dto';
import { UpdatePersonDto } from './dto/update-person.dto';
import { CreatePersonIdentifierDto } from './dto/create-person-identifier.dto';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class PersonsService {
  constructor(
    @InjectRepository(BiometricPersonEntity)
    private readonly personRepository: Repository<BiometricPersonEntity>,
    @InjectRepository(PersonIdentifierEntity)
    private readonly identifierRepository: Repository<PersonIdentifierEntity>,
    private readonly auditService: AuditService,
  ) {}

  async create(dto: CreatePersonDto, createdByUserId: number): Promise<BiometricPersonEntity> {
    const existing = await this.personRepository.findOne({ where: { nationalId: dto.nationalId } });
    if (existing) {
      throw new ConflictException('Ya existe una persona registrada con esa cédula.');
    }

    const person = await this.personRepository.save(this.personRepository.create({ ...dto, createdByUserId }));
    // Nunca valores de datos personales en la auditoría: solo el id del registro.
    this.auditService.annotate({ eventType: 'PERSON_CREATED', targetType: 'Person', targetId: person.id });
    return person;
  }

  async findAll(search?: string): Promise<BiometricPersonEntity[]> {
    const persons = !search
      ? await this.personRepository.find({ order: { createdAt: 'DESC' } })
      : await this.personRepository.find({
          where: [{ nationalId: Like(`%${search}%`) }, { lastName: Like(`%${search}%`) }],
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
