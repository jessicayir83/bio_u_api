/**
 * Controles de calidad de una captura facial, independientes de face-api
 * (funciones puras sobre cajas, landmarks y píxeles) para poder ajustarlos
 * sin tocar el provider.
 *
 * Por qué existen: una foto borrosa, girada o de otra persona que entra al
 * registro "contamina" a esa persona para todos sus ingresos posteriores,
 * y un probe malo produce falsos negativos. Mejor rechazar con un mensaje
 * que diga qué corregir.
 *
 * Valores iniciales medidos (2026-09-15) con fotos de prueba simulando
 * encuadres de webcam 640x480 — ver `documentation`. Afinar con datos
 * reales usando `npm run calibrate:face`.
 */

export type FaceDetectorKind = 'ssd' | 'tiny';

/** `enrollment` = foto que se guarda como template (estricto); `probe` = foto para verificar/identificar (tolerante). */
export type FaceCapturePurpose = 'enrollment' | 'probe';

export interface FaceQualityProfile {
  minDetectionScore: number;
  /** Ancho mínimo en píxeles de la caja detectada. */
  minFaceWidthPx: number;
  /** Desvío máximo de la nariz respecto del centro de la mandíbula (0 = de frente, 0.5 = perfil). */
  maxYawOffset: number;
  maxRollDegrees: number;
  /** Varianza del Laplaciano del rostro normalizado a 128x128. */
  minSharpness: number;
}

const BASE_PROFILES: Record<FaceCapturePurpose, Omit<FaceQualityProfile, 'minDetectionScore'>> = {
  enrollment: { minFaceWidthPx: 100, maxYawOffset: 0.12, maxRollDegrees: 20, minSharpness: 35 },
  probe: { minFaceWidthPx: 70, maxYawOffset: 0.2, maxRollDegrees: 30, minSharpness: 20 },
};

/** Cada detector puntúa en otra escala: SSD da ~0.95+ a un rostro claro, Tiny ~0.7-0.85. */
const MIN_DETECTION_SCORE: Record<FaceDetectorKind, Record<FaceCapturePurpose, number>> = {
  ssd: { enrollment: 0.85, probe: 0.7 },
  tiny: { enrollment: 0.7, probe: 0.5 },
};

/** Una segunda cara cuenta como "otra persona en cuadro" si mide al menos esta fracción de la principal. */
export const SECONDARY_FACE_MIN_RELATIVE_WIDTH = 0.5;

export function getFaceQualityProfile(detector: FaceDetectorKind, purpose: FaceCapturePurpose): FaceQualityProfile {
  return { ...BASE_PROFILES[purpose], minDetectionScore: MIN_DETECTION_SCORE[detector][purpose] };
}

export interface Point {
  x: number;
  y: number;
}

export interface FacePose {
  yawOffset: number;
  rollDegrees: number;
}

function centroid(points: Point[], from: number, to: number): Point {
  let x = 0;
  let y = 0;
  for (let i = from; i <= to; i++) {
    x += points[i].x;
    y += points[i].y;
  }
  const count = to - from + 1;
  return { x: x / count, y: y / count };
}

/**
 * Pose aproximada a partir de los 68 landmarks (índices del modelo iBUG
 * 68): yaw por la posición de la punta de la nariz (30) entre los extremos
 * de la mandíbula (0 y 16), roll por el ángulo entre los centros de los
 * ojos (36-41 y 42-47).
 */
export function estimateFacePose(landmarks: Point[]): FacePose {
  const jawLeft = landmarks[0];
  const jawRight = landmarks[16];
  const noseTip = landmarks[30];
  const jawWidth = jawRight.x - jawLeft.x;
  const yawRatio = jawWidth !== 0 ? (noseTip.x - jawLeft.x) / jawWidth : 0.5;

  const leftEye = centroid(landmarks, 36, 41);
  const rightEye = centroid(landmarks, 42, 47);
  const rollDegrees = (Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * 180) / Math.PI;

  return { yawOffset: Math.abs(yawRatio - 0.5), rollDegrees: Math.abs(rollDegrees) };
}

/** Varianza del Laplaciano (kernel 4-vecinos) sobre una imagen en escala de grises: baja = borrosa. */
export function laplacianVariance(gray: Float32Array, width: number, height: number): number {
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const value = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += value;
      sumSquares += value * value;
      count++;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return sumSquares / count - mean * mean;
}

export interface FaceQualityMetrics {
  detectionScore: number;
  faceWidthPx: number;
  pose: FacePose;
  sharpness: number;
  /** Rostros adicionales de tamaño comparable al principal. */
  otherFaces: number;
}

/** Devuelve el mensaje para la persona si la captura no cumple el perfil, o null si está bien. */
export function findFaceQualityProblem(metrics: FaceQualityMetrics, profile: FaceQualityProfile): string | null {
  if (metrics.otherFaces > 0) {
    return 'Hay más de un rostro en la imagen. Asegurate de estar solo/a frente a la cámara.';
  }
  if (metrics.faceWidthPx < profile.minFaceWidthPx) {
    return 'El rostro se ve muy pequeño. Acercate a la cámara.';
  }
  if (metrics.detectionScore < profile.minDetectionScore) {
    return 'No se ve bien el rostro. Mirá de frente a la cámara, con buena luz y sin cubrirte la cara.';
  }
  if (metrics.pose.yawOffset > profile.maxYawOffset) {
    return 'Tenés la cara girada hacia un costado. Mirá de frente a la cámara.';
  }
  if (metrics.pose.rollDegrees > profile.maxRollDegrees) {
    return 'Tenés la cabeza inclinada. Mantenela derecha.';
  }
  if (metrics.sharpness < profile.minSharpness) {
    return 'La imagen salió borrosa. Quedate quieto/a un momento.';
  }
  return null;
}
