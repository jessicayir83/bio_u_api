import { Controller, MaxFileSizeValidator, Param, ParseFilePipe, ParseIntPipe, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { VerificationService } from './verification.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

const MAX_SAMPLE_SIZE_BYTES = 5 * 1024 * 1024;

@Controller('verification')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin', 'Operator')
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @Post('faces/:personId')
  @UseInterceptors(FileInterceptor('image'))
  verifyFace(
    @Param('personId', ParseIntPipe) personId: number,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: MAX_SAMPLE_SIZE_BYTES })],
      }),
    )
    image: Express.Multer.File,
  ) {
    return this.verificationService.verify('Face', personId, image.buffer);
  }

  @Post('fingerprints/:personId')
  @UseInterceptors(FileInterceptor('image'))
  verifyFingerprint(
    @Param('personId', ParseIntPipe) personId: number,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: MAX_SAMPLE_SIZE_BYTES })],
      }),
    )
    sample: Express.Multer.File,
  ) {
    return this.verificationService.verify('Fingerprint', personId, sample.buffer);
  }
}
