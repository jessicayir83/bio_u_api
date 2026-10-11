import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import configuration, { AppConfig } from './config/configuration';
import { AppThrottlerGuard } from './common/throttler/app-throttler.guard';
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
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: '.env',
    }),
    // Límite por IP y por ruta. Los números salen de `throttle` en configuration.ts;
    // cada ruta elige su política con @RateLimit(...) (ver common/throttler/).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const throttle = configService.get<AppConfig['throttle']>('throttle')!;
        return [{ ttl: throttle.ttlSeconds * 1000, limit: throttle.default }];
      },
    }),
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
  // Orden = orden de ejecución: 1) rate limit, 2) sesión válida, 3) rol/política (deny-by-default).
  // Ver auth/decorators/access.decorator.ts.
  providers: [
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
