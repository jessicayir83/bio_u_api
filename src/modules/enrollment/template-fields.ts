import { BiometricDescriptor } from '../biometric-providers/biometric-provider.interface';
import type { FaceDetectorKind, FacePoseStep } from '../biometric-providers/face/face-quality';
import { TemplateEntity, TemplateSource } from './entities/template.entity';

/**
 * Campos de procedencia y calidad que acompañan a todo template nuevo
 * (Nivel 2, script 09).
 *
 * Vive acá y no en cada servicio porque hay cuatro caminos que crean
 * templates (captura del panel, registro del kiosco, registro guiado y
 * adaptativos) y un template sin procedencia es exactamente el problema que
 * el Nivel 2 vino a resolver: no poder saber de dónde salió un vector.
 *
 * Los proveedores sin controles de calidad (el mock de huella) no devuelven
 * `quality`: en ese caso el detector y las métricas quedan en `null`, que es
 * lo correcto — no hay detector facial involucrado.
 */
export function templateProvenanceFields(
  descriptor: BiometricDescriptor,
  detector: FaceDetectorKind,
  options: { source?: TemplateSource; poseStep?: FacePoseStep | null } = {},
): Partial<TemplateEntity> {
  const quality = descriptor.quality;
  return {
    source: options.source ?? 'ENROLLMENT',
    poseStep: options.poseStep ?? null,
    detector: quality ? detector : null,
    detectionScore: quality?.detectionScore ?? null,
    yawOffset: quality?.poseOffset ?? null,
    sharpness: quality?.sharpness ?? null,
  };
}
