import { Controller, MaxFileSizeValidator, Param, ParseFilePipe, ParseIntPipe, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IMAGE_UPLOAD_LIMITS } from '../../common/uploads/upload-limits';
import { VerificationService } from './verification.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { RateLimit } from '../../common/throttler/rate-limit.decorator';

const MAX_SAMPLE_SIZE_BYTES = 5 * 1024 * 1024;

@Controller('verification')
@Roles('Admin', 'Operator')
@RateLimit('biometric')
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @Post('faces/:personId')
  @UseInterceptors(FileInterceptor('image', { limits: IMAGE_UPLOAD_LIMITS }))
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
  @UseInterceptors(FileInterceptor('image', { limits: IMAGE_UPLOAD_LIMITS }))
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
