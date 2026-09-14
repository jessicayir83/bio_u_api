import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig } from '../config/configuration';

/**
 * Conexión a SQL Server (BiometricPlatformDB).
 *
 * Toda la configuración viene de variables de entorno (ver .env.example),
 * nunca de valores hardcodeados en el código, tal como define el plan
 * de la plataforma (sección "Configuración mediante variables de entorno").
 *
 * `autoLoadEntities: true` permite que cada módulo de negocio (Persons,
 * Enrollment, etc.) registre sus propias entidades sin tocar este archivo.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const db = configService.get<AppConfig['database']>('database')!;
        return {
          type: 'mssql' as const,
          host: db.host,
          port: db.port,
          database: db.name,
          username: db.user,
          password: db.password,
          options: {
            trustServerCertificate: db.trustServerCertificate,
            encrypt: db.encrypt,
          },
          autoLoadEntities: true,
          synchronize: false, // Nunca en biometría: las tablas se crean con scripts SQL versionados
        };
      },
    }),
  ],
})
export class DatabaseModule {}
