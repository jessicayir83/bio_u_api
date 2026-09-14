import { Module } from '@nestjs/common';
import { PersonsModule } from '../persons/persons.module';
import { EnrollmentModule } from '../enrollment/enrollment.module';
import { FaceProviderModule } from '../biometric-providers/face/face-provider.module';
import { FingerprintProviderModule } from '../biometric-providers/fingerprint/fingerprint-provider.module';
import { VerificationService } from './verification.service';
import { VerificationController } from './verification.controller';

@Module({
  imports: [PersonsModule, EnrollmentModule, FaceProviderModule, FingerprintProviderModule],
  controllers: [VerificationController],
  providers: [VerificationService],
  // Lo reutiliza KioskModule para la identificación 1:N.
  exports: [VerificationService],
})
export class VerificationModule {}
