import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { UserEntity } from '../auth/entities/user.entity';
import { RoleEntity } from '../auth/entities/role.entity';
import { UserRoleEntity } from '../auth/entities/user-role.entity';
import { AppConfig } from '../../config/configuration';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

export interface UserSummary {
  id: number;
  username: string;
  email: string;
  fullName: string | null;
  isActive: boolean;
  roles: string[];
  createdAt: Date;
}

@Injectable()
export class UsersService {
  private readonly bcryptSaltRounds: number;

  constructor(
    @InjectRepository(UserEntity) private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(RoleEntity) private readonly roleRepository: Repository<RoleEntity>,
    @InjectRepository(UserRoleEntity) private readonly userRoleRepository: Repository<UserRoleEntity>,
    configService: ConfigService,
  ) {
    this.bcryptSaltRounds = configService.get<AppConfig['auth']>('auth')!.bcryptSaltRounds;
  }

  async findAll(): Promise<UserSummary[]> {
    const users = await this.userRepository.find({ relations: { userRoles: { role: true } }, order: { createdAt: 'DESC' } });
    return users.map((user) => this.toSummary(user));
  }

  async findOne(id: number): Promise<UserSummary> {
    const user = await this.userRepository.findOne({ where: { id }, relations: { userRoles: { role: true } } });
    if (!user) {
      throw new NotFoundException(`No existe un usuario con id ${id}.`);
    }
    return this.toSummary(user);
  }

  async create(dto: CreateUserDto): Promise<UserSummary> {
    const existing = await this.userRepository.findOne({
      where: [{ username: dto.username }, { email: dto.email }],
    });
    if (existing) {
      throw new ConflictException('Ya existe un usuario con ese username o email.');
    }

    const roles = await this.roleRepository.findBy({ id: In(dto.roleIds) });
    if (roles.length !== dto.roleIds.length) {
      throw new BadRequestException('Uno o más roleIds no existen.');
    }

    const passwordHash = await bcrypt.hash(dto.password, this.bcryptSaltRounds);
    const user = await this.userRepository.save(
      this.userRepository.create({
        username: dto.username,
        email: dto.email,
        fullName: dto.fullName ?? null,
        passwordHash,
      }),
    );

    await this.userRoleRepository.save(roles.map((role) => this.userRoleRepository.create({ userId: user.id, roleId: role.id })));

    return this.findOne(user.id);
  }

  async update(id: number, dto: UpdateUserDto): Promise<UserSummary> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`No existe un usuario con id ${id}.`);
    }

    if (dto.email && dto.email !== user.email) {
      const emailTaken = await this.userRepository.findOne({ where: { email: dto.email } });
      if (emailTaken) {
        throw new ConflictException('Ya existe un usuario con ese email.');
      }
      user.email = dto.email;
    }

    if (dto.fullName !== undefined) {
      user.fullName = dto.fullName;
    }

    await this.userRepository.save(user);

    if (dto.roleIds) {
      const roles = await this.roleRepository.findBy({ id: In(dto.roleIds) });
      if (roles.length !== dto.roleIds.length) {
        throw new BadRequestException('Uno o más roleIds no existen.');
      }
      await this.userRoleRepository.delete({ userId: id });
      await this.userRoleRepository.save(roles.map((role) => this.userRoleRepository.create({ userId: id, roleId: role.id })));
    }

    return this.findOne(id);
  }

  async deactivate(id: number): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`No existe un usuario con id ${id}.`);
    }
    user.isActive = false;
    await this.userRepository.save(user);
  }

  async activate(id: number): Promise<UserSummary> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`No existe un usuario con id ${id}.`);
    }
    user.isActive = true;
    await this.userRepository.save(user);
    return this.findOne(id);
  }

  private toSummary(user: UserEntity): UserSummary {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      isActive: user.isActive,
      roles: user.userRoles.map((userRole) => userRole.role.name),
      createdAt: user.createdAt,
    };
  }
}
