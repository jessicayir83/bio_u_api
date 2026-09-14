import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import type { HttpsOptions } from '@nestjs/common/interfaces/external/https-options.interface';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from './app.module';
import configuration, { getEncryptionKeyBuffer } from './config/configuration';

/**
 * HTTPS opcional (HTTPS_ENABLED=true): la cámara del kiosco solo funciona
 * en `localhost` o por HTTPS, así que hace falta para probar desde un
 * teléfono de la red local. Con certificado autofirmado el navegador
 * muestra advertencia — es esperable en desarrollo.
 */
function resolveHttpsOptions(): HttpsOptions | undefined {
  const { https } = configuration();
  if (!https.enabled) {
    return undefined;
  }

  const keyPath = path.resolve(process.cwd(), https.keyPath);
  const certPath = path.resolve(process.cwd(), https.certPath);
  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    throw new Error(
      `HTTPS_ENABLED=true pero no se encontraron los certificados (${keyPath}, ${certPath}). ` +
        'Generalos con el comando documentado en el README o apagá HTTPS_ENABLED.',
    );
  }

  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
}

async function bootstrap() {
  // Fail-fast: si ENCRYPTION_KEY falta o es inválida, mejor que la API no
  // arranque a que falle silenciosamente en la primera captura/verificación.
  getEncryptionKeyBuffer();

  const httpsOptions = resolveHttpsOptions();
  const app = await NestFactory.create(AppModule, httpsOptions ? { httpsOptions } : {});

  // CORS habilitado para que el frontend local (Vite, otro puerto) pueda llamar al API.
  app.enableCors();

  // Valida y transforma automáticamente los DTOs marcados con class-validator.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  const configService = app.get(ConfigService);
  const port = configService.get<number>('port') ?? 5001;

  // 0.0.0.0 para aceptar conexiones de otros dispositivos de la red (teléfono/tablet).
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`Biometric Platform API escuchando en ${httpsOptions ? 'https' : 'http'}://localhost:${port}`);
}

bootstrap();
