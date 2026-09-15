import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { PersonsModule } from './modules/persons/persons.module';
import { EnrollmentModule } from './modules/enrollment/enrollment.module';
import { UsersModule } from './modules/users/users.module';
import { VerificationModule } from './modules/verification/verification.module';
import { KioskModule } from './modules/kiosk/kiosk.module';
import { AuditModule } from './modules/audit/audit.module';
import { IpBlockingModule } from './modules/ip-blocking/ip-blocking.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: '.env',
    }),
    // Límite global por IP; el kiosco (público) lo ajusta con @Throttle.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    DatabaseModule,
    // Global: todos los módulos pueden inyectar AuditService (Fase 9).
    AuditModule,
    IpBlockingModule,
    HealthModule,
    AuthModule,
    PersonsModule,
    EnrollmentModule,
    UsersModule,
    VerificationModule,
    KioskModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
