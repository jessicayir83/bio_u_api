import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { BiometricPersonEntity } from './entities/biometric-person.entity';
import { PersonIdentifierEntity } from './entities/person-identifier.entity';
import { CreatePersonDto } from './dto/create-person.dto';
import { UpdatePersonDto } from './dto/update-person.dto';
import { CreatePersonIdentifierDto } from './dto/create-person-identifier.dto';

@Injectable()
export class PersonsService {
  constructor(
    @InjectRepository(BiometricPersonEntity)
    private readonly personRepository: Repository<BiometricPersonEntity>,
    @InjectRepository(PersonIdentifierEntity)
    private readonly identifierRepository: Repository<PersonIdentifierEntity>,
  ) {}

  async create(dto: CreatePersonDto, createdByUserId: number): Promise<BiometricPersonEntity> {
    const existing = await this.personRepository.findOne({ where: { nationalId: dto.nationalId } });
    if (existing) {
      throw new ConflictException('Ya existe una persona registrada con esa cédula.');
    }

    const person = this.personRepository.create({ ...dto, createdByUserId });
    return this.personRepository.save(person);
  }

  async findAll(search?: string): Promise<BiometricPersonEntity[]> {
    if (!search) {
      return this.personRepository.find({ order: { createdAt: 'DESC' } });
    }

    return this.personRepository.find({
      where: [{ nationalId: Like(`%${search}%`) }, { lastName: Like(`%${search}%`) }],
      order: { createdAt: 'DESC' },
    });
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
    Object.assign(person, dto);
    await this.personRepository.save(person);
    return this.findOne(id);
  }

  /** Soft delete: un registro de identidad nunca se borra físicamente. */
  async deactivate(id: number): Promise<void> {
    const person = await this.findOne(id);
    person.isActive = false;
    await this.personRepository.save(person);
  }

  async addIdentifier(personId: number, dto: CreatePersonIdentifierDto): Promise<PersonIdentifierEntity> {
    await this.findOne(personId);

    const existing = await this.identifierRepository.findOne({
      where: { identifierType: dto.identifierType, identifierValue: dto.identifierValue },
    });
    if (existing) {
      throw new ConflictException('Ya existe un identificador con ese tipo y valor.');
    }

    const identifier = this.identifierRepository.create({ ...dto, personId });
    return this.identifierRepository.save(identifier);
  }

  async removeIdentifier(personId: number, identifierId: number): Promise<void> {
    const identifier = await this.identifierRepository.findOne({ where: { id: identifierId, personId } });
    if (!identifier) {
      throw new NotFoundException(`No existe el identificador ${identifierId} para la persona ${personId}.`);
    }
    await this.identifierRepository.remove(identifier);
  }
}
