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

export interface BiometricDescriptor {
  /** Vector de características (128-d en face-api.js, 32 bytes en el mock de huella). */
  vector: number[];
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
