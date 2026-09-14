import {
  Body,
  Controller,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { EnrollmentService } from './enrollment.service';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { UpdateEnrollmentStatusDto } from './dto/update-enrollment-status.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

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

  @Post(':id/capture')
  @UseGuards(RolesGuard)
  @Roles('Admin', 'Operator')
  @UseInterceptors(FileInterceptor('image'))
  capture(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: MAX_IMAGE_SIZE_BYTES })],
      }),
    )
    image: Express.Multer.File,
  ) {
    return this.enrollmentService.capture(id, image.buffer);
  }
}
