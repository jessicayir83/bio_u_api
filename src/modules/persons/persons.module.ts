import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BiometricPersonEntity } from './entities/biometric-person.entity';
import { PersonIdentifierEntity } from './entities/person-identifier.entity';
import { PersonsService } from './persons.service';
import { PersonsController } from './persons.controller';
import { PersonRegistrationEntity } from './entities/person-registration.entity';
import { PersonRegistrationService } from './person-registration.service';
// Historial de escaneos de la persona: la tabla la escribe el kiosco/verificación,
// acá solo se registra la entidad para leerla (sin importar KioskModule → evita ciclo).
import { AccessLogEntity } from '../kiosk/entities/access-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([BiometricPersonEntity, PersonIdentifierEntity, PersonRegistrationEntity, AccessLogEntity])],
  controllers: [PersonsController],
  providers: [PersonsService, PersonRegistrationService],
  // TypeOrmModule: EnrollmentModule/VerificationModule reusan repositorios (persona, AccessLog).
  // PersonRegistrationService: el kiosco normaliza la identificación y registra sus intentos.
  exports: [TypeOrmModule, PersonRegistrationService],
})
export class PersonsModule {}
