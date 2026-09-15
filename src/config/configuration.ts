/**
 * Biometric.Platform.Configuration (equivalente Node)
 *
 * Centraliza TODA la configuración por variables de entorno.
 * Ningún otro módulo debe leer process.env directamente:
 * siempre a través de este objeto (inyectado vía ConfigService).
 */
export interface AppConfig {
  port: number;
  nodeEnv: string;
  /**
   * HTTPS opcional para desarrollo: la cámara del kiosco (`getUserMedia`)
   * solo funciona en `localhost` o por HTTPS, así que hace falta para
   * probar desde un teléfono/tablet de la red local. Apagado por defecto.
   */
  https: {
    enabled: boolean;
    keyPath: string;
    certPath: string;
  };
  /**
   * Valor de Express `trust proxy`: desde qué proxies se acepta
   * X-Forwarded-For para calcular `req.ip` (rate limiting y AccessLog).
   * `loopback` = solo si la conexión llega de 127.0.0.1/::1 (Vite proxy +
   * Cloudflare Tunnel en la misma PC); un cliente de la red que pegue
   * directo al puerto no puede falsificar su IP con ese header.
   */
  trustProxy: string;
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
    trustServerCertificate: boolean;
    encrypt: boolean;
  };
  auth: {
    jwtSecret: string;
    accessTokenExpiresIn: string;
    refreshTokenExpiresInDays: number;
    issuer: string;
    audience: string;
    bcryptSaltRounds: number;
  };
  /** Auditoría (Fase 9) — ver api/src/modules/audit/README.md. */
  audit: {
    /** Si falla la escritura en la base, el evento se agrega a este archivo JSONL para no perderlo. */
    fallbackFile: string;
    /** SEV1 por ráfaga: N intentos (login, kiosco, 404, 429, 401, 403) de una misma IP dentro de la ventana. */
    burstThreshold: number;
    burstWindowSeconds: number;
    /** SEV1 por escaneo de rutas: N respuestas 404 de una misma IP dentro de la ventana de ráfaga. */
    scanThreshold: number;
    /** SEV2 por fallos repetidos: N fallos (registro/ingreso del kiosco, login de una cuenta) dentro de la ventana. */
    repeatedFailureThreshold: number;
    repeatedFailureWindowMinutes: number;
  };
  biometrics: {
    /**
     * `ssd` (SsdMobilenetv1): recorte más preciso → mejor descriptor, ~2x más
     * lento. `tiny`: el detector original de Fase 5. Cambiarlo altera los
     * descriptores (~0.15-0.2 de distancia sobre la misma foto): conviene
     * reenrolar tras el cambio.
     */
    faceDetector: 'ssd' | 'tiny';
    faceModelsPath: string;
    faceMatchThreshold: number;
    faceIdentifyMargin: number;
  };
}

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '5001', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  https: {
    enabled: (process.env.HTTPS_ENABLED ?? 'false') === 'true',
    keyPath: process.env.HTTPS_KEY_PATH ?? '../certs/dev-key.pem',
    certPath: process.env.HTTPS_CERT_PATH ?? '../certs/dev-cert.pem',
  },
  trustProxy: process.env.TRUST_PROXY ?? 'loopback',
  database: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '1433', 10),
    name: process.env.DB_NAME ?? 'BiometricPlatformDB',
    user: process.env.DB_USER ?? '',
    password: process.env.DB_PASSWORD ?? '',
    trustServerCertificate: (process.env.DB_TRUST_SERVER_CERTIFICATE ?? 'true') === 'true',
    encrypt: (process.env.DB_ENCRYPT ?? 'false') === 'true',
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET ?? '',
    accessTokenExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshTokenExpiresInDays: parseInt(process.env.JWT_REFRESH_EXPIRES_IN_DAYS ?? '7', 10),
    issuer: process.env.JWT_ISSUER ?? 'biometric-platform-api',
    audience: process.env.JWT_AUDIENCE ?? 'biometric-platform-clients',
    bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS ?? '10', 10),
  },
  audit: {
    fallbackFile: process.env.AUDIT_FALLBACK_FILE ?? 'logs/audit-fallback.jsonl',
    burstThreshold: parseInt(process.env.AUDIT_BURST_THRESHOLD ?? '10', 10),
    burstWindowSeconds: parseInt(process.env.AUDIT_BURST_WINDOW_SECONDS ?? '60', 10),
    scanThreshold: parseInt(process.env.AUDIT_SCAN_THRESHOLD ?? '20', 10),
    repeatedFailureThreshold: parseInt(process.env.AUDIT_REPEATED_FAILURE_THRESHOLD ?? '5', 10),
    repeatedFailureWindowMinutes: parseInt(process.env.AUDIT_REPEATED_FAILURE_WINDOW_MINUTES ?? '10', 10),
  },
  biometrics: {
    faceDetector: process.env.FACE_DETECTOR === 'tiny' ? 'tiny' : 'ssd',
    faceModelsPath: process.env.FACE_MODELS_PATH ?? 'models',
    faceMatchThreshold: parseFloat(process.env.FACE_MATCH_THRESHOLD ?? '0.6'),
    faceIdentifyMargin: parseFloat(process.env.FACE_IDENTIFY_MARGIN ?? '0.05'),
  },
});

/**
 * Excepción puntual a "todo pasa por ConfigService": los column
 * transformers de TypeORM (ver
 * api/src/common/encryption/vector-encryption.transformer.ts) se
 * instancian fuera del contenedor de DI de Nest y no pueden inyectar
 * ConfigService. Esta función sigue siendo la única que lee
 * `process.env.ENCRYPTION_KEY` directamente — el transformer la importa
 * y la llama en vez de leer process.env por su cuenta.
 */
export function getEncryptionKeyBuffer(): Buffer {
  const value = process.env.ENCRYPTION_KEY ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(
      'ENCRYPTION_KEY inválida: se esperaban 64 caracteres hexadecimales (32 bytes). ' +
        'Genera uno con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return Buffer.from(value, 'hex');
}
