import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PersonsService } from './persons.service';
import { CreatePersonDto } from './dto/create-person.dto';
import { UpdatePersonDto } from './dto/update-person.dto';
import { CreatePersonIdentifierDto } from './dto/create-person-identifier.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';

@Controller('persons')
@UseGuards(JwtAuthGuard)
export class PersonsController {
  constructor(private readonly personsService: PersonsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Admin', 'Operator')
  create(@Body() dto: CreatePersonDto, @CurrentUser() user: AuthenticatedUser) {
    return this.personsService.create(dto, user.userId);
  }

  @Get()
  findAll(@Query('search') search?: string) {
    return this.personsService.findAll(search);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.personsService.findOne(id);
  }

  @Get(':id/scans')
  findScans(@Param('id', ParseIntPipe) id: number) {
    return this.personsService.findScans(id);
  }

  @Get(':id/registrations')
  findRegistrations(@Param('id', ParseIntPipe) id: number) {
    return this.personsService.findRegistrations(id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Admin', 'Operator')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePersonDto) {
    return this.personsService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('Admin', 'Operator')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivate(@Param('id', ParseIntPipe) id: number) {
    await this.personsService.deactivate(id);
  }

  @Post(':id/identifiers')
  @UseGuards(RolesGuard)
  @Roles('Admin', 'Operator')
  addIdentifier(@Param('id', ParseIntPipe) id: number, @Body() dto: CreatePersonIdentifierDto) {
    return this.personsService.addIdentifier(id, dto);
  }

  @Delete(':id/identifiers/:identifierId')
  @UseGuards(RolesGuard)
  @Roles('Admin', 'Operator')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeIdentifier(
    @Param('id', ParseIntPipe) id: number,
    @Param('identifierId', ParseIntPipe) identifierId: number,
  ) {
    await this.personsService.removeIdentifier(id, identifierId);
  }
}
