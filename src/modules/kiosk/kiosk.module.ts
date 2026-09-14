import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessLogEntity } from './entities/access-log.entity';
import { KioskService } from './kiosk.service';
import { KioskController } from './kiosk.controller';
import { PersonsModule } from '../persons/persons.module';
import { EnrollmentModule } from '../enrollment/enrollment.module';
import { VerificationModule } from '../verification/verification.module';
import { FaceProviderModule } from '../biometric-providers/face/face-provider.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AccessLogEntity]),
    PersonsModule,
    EnrollmentModule,
    VerificationModule,
    FaceProviderModule,
    // Solo para leer el id del usuario de sistema `kiosk` (CreatedByUserId).
    AuthModule,
  ],
  controllers: [KioskController],
  providers: [KioskService],
})
export class KioskModule {}
