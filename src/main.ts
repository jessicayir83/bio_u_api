import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { HttpsOptions } from '@nestjs/common/interfaces/external/https-options.interface';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from './app.module';
import configuration, { AppConfig, getEncryptionKeyBuffer } from './config/configuration';
import { AuditService } from './modules/audit/audit.service';
import { createAuditHttpMiddleware } from './modules/audit/audit-http.middleware';
import { IpBlockService } from './modules/ip-blocking/ip-block.service';
import { createIpBlockMiddleware } from './modules/ip-blocking/ip-block.middleware';

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
  const app = await NestFactory.create<NestExpressApplication>(AppModule, httpsOptions ? { httpsOptions } : {});

  // CORS habilitado para que el frontend local (Vite, otro puerto) pueda llamar al API.
  app.enableCors();

  const configService = app.get(ConfigService);

  // Detrás del proxy de Vite / Cloudflare Tunnel todas las conexiones llegan
  // desde 127.0.0.1: sin esto el rate limit por IP del kiosco se comparte
  // entre todos los visitantes y AccessLog guarda siempre localhost.
  app.set('trust proxy', configService.get<string>('trustProxy') ?? 'loopback');

  // Auditoría de CADA request (Fase 9). Registrado acá con app.use y no como
  // middleware de módulo: así queda antes de los parsers de body que Nest
  // agrega en listen(), y audita también requests que fallan temprano.
  const auditService = app.get(AuditService);
  app.use(createAuditHttpMiddleware(auditService));
  // IPs bloqueadas por un Admin (dashboard de auditoría): 403 en todo el API.
  // Después del de auditoría para que el intento rechazado también quede registrado.
  app.use(createIpBlockMiddleware(app.get(IpBlockService), auditService));

  // Permite auditar el apagado del API (SYSTEM_SHUTDOWN) ante Ctrl+C / reinicio.
  app.enableShutdownHooks();

  // Valida y transforma automáticamente los DTOs marcados con class-validator.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  const port =configService.get<number>('port') ?? 5001;

  // 0.0.0.0 para aceptar conexiones de otros dispositivos de la red (teléfono/tablet).
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`Bio U API escuchando en ${httpsOptions ? 'https' : 'http'}://localhost:${port}`);
  await auditService.recordSystemStartup({
    port,
    https: !!httpsOptions,
    nodeEnv: configService.get<string>('nodeEnv'),
    faceDetector: configService.get<AppConfig['biometrics']>('biometrics')?.faceDetector,
    pid: process.pid,
  });
}

bootstrap();
