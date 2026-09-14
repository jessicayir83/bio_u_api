import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  BiometricCompareResult,
  BiometricDescriptor,
  BiometricProvider,
  InvalidBiometricInputError,
} from '../biometric-provider.interface';

/**
 * Mock — sin lector de huella físico todavía (ver plan_implementation).
 * NO hace matching biométrico real: solo hashea la muestra (SHA-256) y
 * compara igualdad exacta. Sirve para validar el flujo completo
 * (enrollment -> captura -> verificación) antes de integrar un SDK real
 * cuando se consiga hardware (Fase 6). Nunca reportará una coincidencia
 * "parcial" — o son bytes idénticos, o no coincide.
 */
@Injectable()
export class MockFingerprintProvider implements BiometricProvider {
  async extractDescriptor(input: Buffer): Promise<BiometricDescriptor> {
    if (!input || input.length === 0) {
      throw new InvalidBiometricInputError('La muestra de huella está vacía.');
    }
    const hash = createHash('sha256').update(input).digest();
    return { vector: Array.from(hash) };
  }

  compare(a: BiometricDescriptor, b: BiometricDescriptor): BiometricCompareResult {
    const isMatch = a.vector.length === b.vector.length && a.vector.every((value, index) => value === b.vector[index]);
    return { distance: isMatch ? 0 : 1, isMatch };
  }
}
