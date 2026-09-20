import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { type FacePoseStep, parsePoseSteps } from '../biometric-providers/face/face-quality';
import { EnrollmentService } from './enrollment.service';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { UpdateEnrollmentStatusDto } from './dto/update-enrollment-status.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
/** Un enrollment guiado son 3 poses; la subida de archivo manda una sola. */
const MAX_CAPTURE_PHOTOS = 3;

@Controller('enrollments')
@UseGuards(JwtAuthGuard)
export class EnrollmentController {
  constructor(private readonly enrollmentService: EnrollmentService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Admin', 'Operator')
  create(@Body() dto: CreateEnrollmentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.enrollmentService.create(dto, user.userId);
  }

  @Get()
  findAll(@Query('personId') personId?: string, @Query('status') status?: string) {
    return this.enrollmentService.findAll(personId ? parseInt(personId, 10) : undefined, status);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.enrollmentService.findOne(id);
  }

  @Patch(':id/status')
  @UseGuards(RolesGuard)
  @Roles('Admin', 'Operator')
  updateStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateEnrollmentStatusDto) {
    return this.enrollmentService.updateStatus(id, dto);
  }

  /**
   * Captura biométrica del enrollment. Acepta `images` (hasta 3, registro
   * guiado con su campo `steps`) o `image` (una sola, subida de archivo desde
   * el panel) — se aceptan los dos campos por compatibilidad con Postman y
   * con el flujo anterior, igual que hace el kiosco.
   */
  @Post(':id/capture')
  @UseGuards(RolesGuard)
  @Roles('Admin', 'Operator')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'images', maxCount: MAX_CAPTURE_PHOTOS },
      { name: 'image', maxCount: 1 },
    ]),
  )
  capture(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFiles() files: { images?: Express.Multer.File[]; image?: Express.Multer.File[] },
    @Body('steps') steps?: string,
  ) {
    const uploaded = [...(files?.images ?? []), ...(files?.image ?? [])];
    if (uploaded.length === 0) {
      throw new BadRequestException('Se requiere al menos una imagen.');
    }
    if (uploaded.length > MAX_CAPTURE_PHOTOS) {
      throw new BadRequestException(`Se aceptan hasta ${MAX_CAPTURE_PHOTOS} fotos.`);
    }
    const tooBig = uploaded.find((file) => file.size > MAX_IMAGE_SIZE_BYTES);
    if (tooBig) {
      throw new BadRequestException(`Cada imagen debe pesar menos de ${MAX_IMAGE_SIZE_BYTES / (1024 * 1024)}MB.`);
    }

    let poseSteps: FacePoseStep[] | undefined;
    if (steps) {
      try {
        poseSteps = parsePoseSteps(steps);
      } catch (err) {
        throw new BadRequestException(err instanceof Error ? err.message : 'Pasos de captura inválidos.');
      }
    }

    return this.enrollmentService.capture(
      id,
      uploaded.map((file) => file.buffer),
      poseSteps,
    );
  }
}
