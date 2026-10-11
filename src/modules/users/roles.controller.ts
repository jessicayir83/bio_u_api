import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RoleEntity } from '../auth/entities/role.entity';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('roles')
@Roles('Admin')
export class RolesController {
  constructor(@InjectRepository(RoleEntity) private readonly roleRepository: Repository<RoleEntity>) {}

  @Get()
  findAll() {
    return this.roleRepository.find({ order: { name: 'ASC' } });
  }
}
