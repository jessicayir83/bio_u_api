import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EnrollmentEntity } from './entities/enrollment.entity';
import { TemplateEntity } from './entities/template.entity';
import { EnrollmentService } from './enrollment.service';
import { EnrollmentController } from './enrollment.controller';
import { AdaptiveTemplateService } from './adaptive-template.service';
import { TemplatesService } from './templates.service';
import { TemplatesController } from './templates.controller';
import { PersonsModule } from '../persons/persons.module';
import { FaceProviderModule } from '../biometric-providers/face/face-provider.module';
import { FingerprintProviderModule } from '../biometric-providers/fingerprint/fingerprint-provider.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([EnrollmentEntity, TemplateEntity]),
    PersonsModule,
    FaceProviderModule,
    FingerprintProviderModule,
  ],
  controllers: [EnrollmentController, TemplatesController],
  providers: [EnrollmentService, AdaptiveTemplateService, TemplatesService],
  // TypeOrmModule se reexporta para que VerificationModule reutilice los
  // repositorios de Enrollment/Template (mismo patrón que AuthModule en Fase 4).
  // AdaptiveTemplateService lo usa KioskModule tras un ingreso concedido.
  exports: [TypeOrmModule, AdaptiveTemplateService],
})
export class EnrollmentModule {}
