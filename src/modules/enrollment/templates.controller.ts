import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { TemplatesService } from './templates.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';

export class RevokeTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

/**
 * Galería biométrica. Va bajo `/templates` y no bajo `/persons/:id/templates`
 * para no superponer controladores sobre la misma ruta: el dueño de
 * `biometric.Template` es este módulo, no PersonsModule.
 *
 * Leer la galería: cualquier usuario autenticado, igual que ver una persona.
 * Revocar y restaurar: solo Admin — apagar un rostro puede dejar a alguien sin
 * poder ingresar, y encenderlo de vuelta reactiva biometría que alguien
 * decidió apagar.
 */
@Controller('templates')
@UseGuards(JwtAuthGuard)
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get()
  list(@Query('personId', ParseIntPipe) personId: number) {
    return this.templatesService.listByPerson(personId);
  }

  @Post(':id/revoke')
  @UseGuards(RolesGuard)
  @Roles('Admin')
  revoke(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RevokeTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.templatesService.revoke(id, user.userId, dto.reason);
  }

  @Post(':id/restore')
  @UseGuards(RolesGuard)
  @Roles('Admin')
  restore(@Param('id', ParseIntPipe) id: number) {
    return this.templatesService.restore(id);
  }
}
