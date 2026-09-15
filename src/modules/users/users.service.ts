import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { UserEntity } from '../auth/entities/user.entity';
import { RoleEntity } from '../auth/entities/role.entity';
import { UserRoleEntity } from '../auth/entities/user-role.entity';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
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
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
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

    const roleNames = roles.map((role) => role.name);
    this.auditService.annotate({
      eventType: roleNames.includes('Admin') ? 'USER_ADMIN_ROLE_GRANTED' : 'USER_CREATED',
      targetType: 'User',
      targetId: user.id,
      details: { action: 'CREATE', username: user.username, roles: roleNames },
    });
    return this.findOne(user.id);
  }

  async update(id: number, dto: UpdateUserDto): Promise<UserSummary> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`No existe un usuario con id ${id}.`);
    }
    const before = await this.findOne(id);

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

    const after = await this.findOne(id);
    const rolesAdded = after.roles.filter((role) => !before.roles.includes(role));
    const rolesRemoved = before.roles.filter((role) => !after.roles.includes(role));
    const changedFields = (['email', 'fullName'] as const).filter((field) => before[field] !== after[field]);
    this.auditService.annotate({
      eventType: rolesAdded.includes('Admin')
        ? 'USER_ADMIN_ROLE_GRANTED'
        : rolesRemoved.includes('Admin')
          ? 'USER_ADMIN_ROLE_REVOKED'
          : 'USER_UPDATED',
      targetType: 'User',
      targetId: id,
      details: { action: 'UPDATE', username: after.username, changedFields, rolesAdded, rolesRemoved },
    });
    return after;
  }

  async deactivate(id: number): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`No existe un usuario con id ${id}.`);
    }
    user.isActive = false;
    await this.userRepository.save(user);
    this.auditService.annotate({ eventType: 'USER_DEACTIVATED', targetType: 'User', targetId: id, details: { username: user.username } });
  }

  async activate(id: number): Promise<UserSummary> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`No existe un usuario con id ${id}.`);
    }
    user.isActive = true;
    await this.userRepository.save(user);
    this.auditService.annotate({ eventType: 'USER_ACTIVATED', targetType: 'User', targetId: id, details: { username: user.username } });
    return this.findOne(id);
  }

  /**
   * Admin le asigna una contraseña nueva a OTRO usuario (ej. la olvidó) y
   * le cierra todas las sesiones. Para la propia se usa
   * POST /auth/change-password, que exige la contraseña actual.
   */
  async resetPassword(id: number, newPassword: string, actingUserId: number): Promise<void> {
    if (id === actingUserId) {
      throw new BadRequestException('Para cambiar tu propia contraseña usa "Cambiar contraseña".');
    }

    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`No existe un usuario con id ${id}.`);
    }

    user.passwordHash = await bcrypt.hash(newPassword, this.bcryptSaltRounds);
    await this.userRepository.save(user);
    await this.authService.revokeAllSessions(id);
    this.auditService.annotate({
      eventType: 'USER_PASSWORD_RESET',
      targetType: 'User',
      targetId: id,
      details: { username: user.username, sessionsRevoked: true },
    });
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
