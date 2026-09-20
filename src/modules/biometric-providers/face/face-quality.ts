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

/**
 * Paso del registro guiado (Nivel 2). Tres poses en el eje que más falsos
 * negativos produce (yaw): de frente y un giro leve hacia cada lado.
 *
 * Por qué solo yaw y por qué leve: el descriptor de 128-d de face-api se
 * calcula sobre un recorte alineado por landmarks; con la cara muy girada
 * ese recorte pierde referencias y el vector deja de ser comparable contra
 * una foto frontal. El objetivo no es cubrir el perfil, es que la galería
 * no sean tres fotos idénticas tomadas en diez segundos.
 */
export type FacePoseStep = 'FRONT' | 'LEFT' | 'RIGHT';

export const FACE_POSE_STEPS: readonly FacePoseStep[] = ['FRONT', 'RIGHT', 'LEFT'];

export function isFacePoseStep(value: string): value is FacePoseStep {
  return (FACE_POSE_STEPS as readonly string[]).includes(value);
}

/**
 * Parsea el campo `steps` de un multipart ("FRONT,RIGHT,LEFT") a la lista de
 * pasos. Lanza `Error` con un mensaje usable si algún id es desconocido o se
 * repite; quien llama lo traduce a 400.
 *
 * Se valida estricto a propósito: si un id no se reconoce, la foto se
 * guardaría con la pose equivocada o sin validar, que es peor que rechazar.
 */
export function parsePoseSteps(raw: string): FacePoseStep[] {
  const steps = raw
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter((value) => value.length > 0);

  const unknown = steps.find((value) => !isFacePoseStep(value));
  if (unknown) {
    throw new Error(`Paso de captura desconocido: ${unknown}.`);
  }
  if (new Set(steps).size !== steps.length) {
    throw new Error('Hay pasos de captura repetidos.');
  }
  return steps as FacePoseStep[];
}

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

/**
 * Banda de giro que exige cada paso lateral del registro guiado, medida
 * sobre |yawSigned|.
 *
 * - El piso (0.10) es lo que obliga a que el paso aporte de verdad una pose
 *   distinta: por debajo, es una tercera foto frontal y la galería no gana
 *   nada.
 * - El techo (0.22) es donde el recorte alineado empieza a degradarse y el
 *   descriptor deja de comparar bien contra una foto frontal.
 *
 * Valores iniciales, a confirmar con `npm run calibrate:face` antes/después
 * de reenrolar: si sube el FAR, el sospechoso es el techo.
 */
const GUIDED_STEP_YAW = { min: 0.1, max: 0.22 } as const;

/**
 * Signo de `yawSigned` cuando la persona gira la cabeza hacia SU derecha.
 *
 * Al girar hacia su derecha, ese lado de la cara se aleja de la cámara; en
 * la imagen sin espejar ese lado es el izquierdo, así que la nariz se
 * desplaza hacia el borde izquierdo de la mandíbula → yawRatio < 0.5 →
 * negativo. Es UNA constante a propósito: si la prueba con foto real
 * demuestra lo contrario, se invierte acá y no en cinco lugares.
 */
const YAW_SIGN_PERSON_RIGHT = -1;

export function getFaceQualityProfile(
  detector: FaceDetectorKind,
  purpose: FaceCapturePurpose,
  poseStep?: FacePoseStep,
): FaceQualityProfile {
  const profile = { ...BASE_PROFILES[purpose], minDetectionScore: MIN_DETECTION_SCORE[detector][purpose] };
  if (poseStep && poseStep !== 'FRONT') {
    // Los pasos laterales necesitan permiso para girar; todo lo demás
    // (tamaño, confianza, inclinación, nitidez) sigue igual de estricto.
    profile.maxYawOffset = GUIDED_STEP_YAW.max;
  }
  return profile;
}

/**
 * Valida que la captura corresponda al paso de pose que se pidió. Se corre
 * DESPUÉS de `findFaceQualityProblem` (primero la foto tiene que ser usable;
 * recién después tiene sentido discutir hacia dónde mira).
 */
export function findPoseStepProblem(metrics: FaceQualityMetrics, step: FacePoseStep): string | null {
  const { yawSigned, yawOffset } = metrics.pose;

  if (step === 'FRONT') {
    // El techo frontal ya lo aplicó el perfil; acá no hay nada extra que pedir.
    return null;
  }

  const expectedSign = step === 'RIGHT' ? YAW_SIGN_PERSON_RIGHT : -YAW_SIGN_PERSON_RIGHT;
  const towardsLabel = step === 'RIGHT' ? 'tu derecha' : 'tu izquierda';

  if (Math.sign(yawSigned) !== expectedSign || yawOffset < GUIDED_STEP_YAW.min) {
    return `Girá un poco la cabeza hacia ${towardsLabel}, sin dejar de mirar a la cámara.`;
  }
  if (yawOffset > GUIDED_STEP_YAW.max) {
    return 'Te giraste de más. Volvé un poco hacia el centro.';
  }
  return null;
}

export interface Point {
  x: number;
  y: number;
}

export interface FacePose {
  /** Magnitud del giro, sin lado (0 = de frente, 0.5 = perfil). Es lo que miran los perfiles normales. */
  yawOffset: number;
  /**
   * Giro con signo, para distinguir hacia qué lado está girada la cara en la
   * imagen **sin espejar** (la que recibe el servidor, no la que ve la
   * persona en pantalla). Solo lo usa el registro guiado.
   *
   * El signo se fija en SIGNED_YAW_TOWARDS: qué lado de la persona
   * corresponde a un valor positivo se determinó con fotos de prueba, no por
   * deducción — ver `documentation`.
   */
  yawSigned: number;
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

  const yawSigned = yawRatio - 0.5;
  return { yawOffset: Math.abs(yawSigned), yawSigned, rollDegrees: Math.abs(rollDegrees) };
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
