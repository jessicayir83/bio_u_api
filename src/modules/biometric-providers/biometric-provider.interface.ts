/**
 * Interfaz intercambiable para cualquier motor biométrico (ver
 * plan_implementation: permite cambiar de motor, o migrar a un SDK
 * comercial, sin tocar EnrollmentModule/VerificationModule).
 *
 * Generalizada en Fase 5 al agregar el segundo proveedor real
 * (MockFingerprintProvider) — antes era `FaceProvider`, específica de
 * reconocimiento facial. No depende de NestJS a propósito, para
 * mantenerla portable.
 */

import type { FacePoseStep } from './face/face-quality';

/**
 * Métricas de la captura de la que salió un descriptor. Genérica a
 * propósito: son las dimensiones que cualquier modalidad puede reportar
 * (¿qué tan segura fue la detección?, ¿qué tan grande?, ¿qué tan nítida?,
 * ¿cuánto se desvió de la pose ideal?).
 */
export interface BiometricQualityMetrics {
  detectionScore: number;
  /** Tamaño de la muestra en píxeles (ancho del rostro, en Face). */
  sizePx: number;
  sharpness: number;
  /** Desvío de la pose frontal, sin lado (Face: `yawOffset`). */
  poseOffset: number;
  /** Desvío con signo, para saber hacia qué lado (Face: `yawSigned`). */
  poseOffsetSigned: number;
  /**
   * La muestra cumple el perfil `enrollment` (estricto) aunque se haya
   * extraído como `probe`. Lo resuelve el proveedor, que es el que conoce sus
   * propios umbrales — así quien decide guardar un template aprendido
   * pregunta un booleano en vez de importar la lógica de calidad facial, y
   * sigue funcionando igual el día que el motor sea otro.
   */
  meetsEnrollmentProfile: boolean;
}

export interface BiometricDescriptor {
  /** Vector de características (128-d en face-api.js, 32 bytes en el mock de huella). */
  vector: number[];
  /**
   * Métricas de la captura, si el proveedor las calcula (Face sí, el mock de
   * huella no). Las necesita quien decide DESPUÉS de extraer: el registro
   * guiado (para validar la pose del paso) y los templates adaptativos (para
   * exigirle a un probe calidad de enrollment sin pagar una segunda
   * detección, que cuesta ~1 s).
   */
  quality?: BiometricQualityMetrics;
}

export interface BiometricCompareResult {
  distance: number;
  isMatch: boolean;
}

export class BiometricDetectionError extends Error {
  constructor(message = 'No se detectó ninguna muestra biométrica válida en la entrada.') {
    super(message);
    this.name = 'BiometricDetectionError';
  }
}

/**
 * Hay muestra, pero de calidad insuficiente (borrosa, girada, varias
 * personas...). Extiende BiometricDetectionError a propósito: todo el
 * código que ya traducía ese error a 400 lo cubre sin cambios.
 */
export class BiometricQualityError extends BiometricDetectionError {
  constructor(message: string) {
    super(message);
    this.name = 'BiometricQualityError';
  }
}

export class InvalidBiometricInputError extends Error {
  constructor(message = 'La muestra biométrica recibida no es válida.') {
    super(message);
    this.name = 'InvalidBiometricInputError';
  }
}

export interface ExtractDescriptorOptions {
  /**
   * `enrollment`: la muestra se va a guardar como template → controles de
   * calidad estrictos. `probe` (default): se usa para verificar/identificar.
   * Un provider sin controles de calidad (ej. el mock de huella) lo ignora.
   */
  purpose?: 'enrollment' | 'probe';
  /**
   * Paso del registro guiado al que corresponde esta captura. Si viene, el
   * proveedor valida además que la pose sea la del paso (no alcanza con que
   * la foto sea buena: tiene que ser la foto que se pidió). El mock de
   * huella lo ignora, igual que `purpose`.
   */
  poseStep?: FacePoseStep;
}

export interface BiometricProvider {
  /**
   * Extrae el descriptor de una muestra. Lanza BiometricDetectionError (o
   * su subclase BiometricQualityError) / InvalidBiometricInputError si no es válida.
   */
  extractDescriptor(input: Buffer, options?: ExtractDescriptorOptions): Promise<BiometricDescriptor>;
  /** Compara dos descriptores y determina si corresponden a la misma persona. */
  compare(a: BiometricDescriptor, b: BiometricDescriptor): BiometricCompareResult;
}

export const FACE_PROVIDER = Symbol('FACE_PROVIDER');
export const FINGERPRINT_PROVIDER = Symbol('FINGERPRINT_PROVIDER');
