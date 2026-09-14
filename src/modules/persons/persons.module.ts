import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BiometricPersonEntity } from './entities/biometric-person.entity';
import { PersonIdentifierEntity } from './entities/person-identifier.entity';
import { PersonsService } from './persons.service';
import { PersonsController } from './persons.controller';

@Module({
  imports: [TypeOrmModule.forFeature([BiometricPersonEntity, PersonIdentifierEntity])],
  controllers: [PersonsController],
  providers: [PersonsService],
  // Exporta TypeOrmModule para que EnrollmentModule reuse el repositorio de BiometricPerson.
  exports: [TypeOrmModule],
})
export class PersonsModule {}
