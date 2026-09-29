import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BiometricPersonEntity } from './entities/biometric-person.entity';
import { PersonIdentifierEntity } from './entities/person-identifier.entity';
import { PersonsService } from './persons.service';
import { PersonsController } from './persons.controller';
import { PersonRegistrationEntity } from './entities/person-registration.entity';
import { PersonRegistrationService } from './person-registration.service';
import { PersonConsentEntity } from './entities/person-consent.entity';
import { PersonConsentService } from './person-consent.service';
// Historial de escaneos de la persona: la tabla la escribe el kiosco/verificación,
// acá solo se registra la entidad para leerla (sin importar KioskModule → evita ciclo).
import { AccessLogEntity } from '../kiosk/entities/access-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([BiometricPersonEntity, PersonIdentifierEntity, PersonRegistrationEntity, PersonConsentEntity, AccessLogEntity])],
  controllers: [PersonsController],
  providers: [PersonsService, PersonRegistrationService, PersonConsentService],
  // TypeOrmModule: EnrollmentModule/VerificationModule reusan repositorios (persona, AccessLog).
  // PersonConsentService: kiosco y panel registran el consentimiento al crear a la persona.
  // PersonRegistrationService: el kiosco normaliza la identificación y registra sus intentos.
  exports: [TypeOrmModule, PersonRegistrationService, PersonConsentService],
})
export class PersonsModule {}
