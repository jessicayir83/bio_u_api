import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import { Jimp } from 'jimp';
import * as tf from '@tensorflow/tfjs';
import * as wasm from '@tensorflow/tfjs-backend-wasm';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import * as faceapi from '@vladmandic/face-api/dist/face-api.node-wasm.js';
import { AppConfig } from '../../../config/configuration';
import {
  BiometricCompareResult,
  BiometricDescriptor,
  BiometricDetectionError,
  BiometricProvider,
  BiometricQualityError,
  ExtractDescriptorOptions,
  InvalidBiometricInputError,
} from '../biometric-provider.interface';
import {
  estimateFacePose,
  FaceDetectorKind,
  FaceQualityMetrics,
  findFaceQualityProblem,
  findPoseStepProblem,
  getFaceQualityProfile,
  laplacianVariance,
  SECONDARY_FACE_MIN_RELATIVE_WIDTH,
} from './face-quality';

/** Lado al que se normaliza el recorte del rostro para medir nitidez (comparable entre tamaños de cara). */
const SHARPNESS_SAMPLE_SIZE = 128;
/** Umbral mínimo del detector para considerar una caja: los controles de calidad aplican el suyo después. */
const DETECTOR_MIN_CONFIDENCE = 0.4;

type JimpImage = Awaited<ReturnType<typeof Jimp.read>>;

/**
 * Implementación de FaceProvider con @vladmandic/face-api sobre un
 * backend 100% JS/WASM (sin tfjs-node, sin canvas) — decisión tomada en
 * Fase 5 tras confirmar que @tensorflow/tfjs-node tiene un historial
 * recurrente de binarios precompilados rotos en Windows (mismo criterio
 * que bcryptjs en Fase 2). La imagen se decodifica con `jimp` (puro JS) y
 * se arma el tensor a mano, sin depender de `canvas`/`tf.node`.
 */
@Injectable()
export class FaceApiProvider implements BiometricProvider, OnModuleInit {
  private readonly logger = new Logger(FaceApiProvider.name);
  private readonly matchThreshold: number;
  private readonly modelsPath: string;
  private readonly detector: FaceDetectorKind;
  private modelsLoaded = false;
  private detectorOptions: any;

  constructor(configService: ConfigService) {
    const biometrics = configService.get<AppConfig['biometrics']>('biometrics')!;
    this.matchThreshold = biometrics.faceMatchThreshold;
    this.modelsPath = path.resolve(process.cwd(), biometrics.faceModelsPath);
    this.detector = biometrics.faceDetector;
  }

  async onModuleInit(): Promise<void> {
    const wasmDir = path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm'));
    wasm.setWasmPaths(wasmDir + path.sep);
    await tf.setBackend('wasm');
    await tf.ready();

    if (this.detector === 'ssd') {
      await faceapi.nets.ssdMobilenetv1.loadFromDisk(this.modelsPath);
      this.detectorOptions = new faceapi.SsdMobilenetv1Options({ minConfidence: DETECTOR_MIN_CONFIDENCE });
    } else {
      await faceapi.nets.tinyFaceDetector.loadFromDisk(this.modelsPath);
      this.detectorOptions = new faceapi.TinyFaceDetectorOptions({ scoreThreshold: DETECTOR_MIN_CONFIDENCE });
    }
    await faceapi.nets.faceLandmark68Net.loadFromDisk(this.modelsPath);
    await faceapi.nets.faceRecognitionNet.loadFromDisk(this.modelsPath);

    this.modelsLoaded = true;
    this.logger.log(
      `Modelos de reconocimiento facial cargados desde ${this.modelsPath} (detector: ${this.detector}, backend: ${tf.getBackend()})`,
    );
  }

  async extractDescriptor(imageBuffer: Buffer, options: ExtractDescriptorOptions = {}): Promise<BiometricDescriptor> {
    if (!this.modelsLoaded) {
      throw new Error('FaceApiProvider: los modelos todavía no terminan de cargar.');
    }
    const purpose = options.purpose ?? 'probe';
    const profile = getFaceQualityProfile(this.detector, purpose, options.poseStep);

    const image = await this.readImage(imageBuffer);
    const tensor = this.imageToTensor(image);
    try {
      const faces: any[] = await faceapi.detectAllFaces(tensor, this.detectorOptions).withFaceLandmarks();
      if (faces.length === 0) {
        throw new BiometricDetectionError('No se detectó ningún rostro en la imagen.');
      }

      // Rostro principal = el más grande (el más cercano a la cámara).
      const main = faces.reduce((largest, face) => (face.detection.box.width > largest.detection.box.width ? face : largest));
      const mainWidth: number = main.detection.box.width;

      const metrics: FaceQualityMetrics = {
        detectionScore: main.detection.score,
        faceWidthPx: mainWidth,
        pose: estimateFacePose(main.landmarks.positions),
        sharpness: await this.measureSharpness(image, main.detection.box),
        otherFaces: faces.filter(
          (face) =>
            face !== main &&
            face.detection.score >= profile.minDetectionScore &&
            face.detection.box.width >= mainWidth * SECONDARY_FACE_MIN_RELATIVE_WIDTH,
        ).length,
      };
      // Primero: ¿la foto sirve? Recién después: ¿es la pose que se pidió?
      const problem =
        findFaceQualityProblem(metrics, profile) ?? (options.poseStep ? findPoseStepProblem(metrics, options.poseStep) : null);
      this.logger.debug(
        `Calidad (${purpose}${options.poseStep ? `/${options.poseStep}` : ''}): ` +
          `score=${metrics.detectionScore.toFixed(3)} ancho=${Math.round(metrics.faceWidthPx)}px ` +
          `yaw=${metrics.pose.yawSigned.toFixed(3)} roll=${metrics.pose.rollDegrees.toFixed(1)}° ` +
          `nitidez=${metrics.sharpness.toFixed(1)} otros=${metrics.otherFaces} → ${problem ?? 'OK'}`,
      );
      if (problem) {
        throw new BiometricQualityError(problem);
      }

      // Mismo recorte alineado que usa internamente withFaceDescriptor(), pero
      // solo para el rostro principal (no se calculan descriptores de más).
      const [faceTensor] = await faceapi.extractFaceTensors(tensor, [main.alignedRect]);
      try {
        const descriptor: Float32Array = await faceapi.nets.faceRecognitionNet.computeFaceDescriptor(faceTensor);
        return {
          vector: Array.from(descriptor),
          quality: {
            detectionScore: metrics.detectionScore,
            sizePx: metrics.faceWidthPx,
            sharpness: metrics.sharpness,
            poseOffset: metrics.pose.yawOffset,
            poseOffsetSigned: metrics.pose.yawSigned,
            // Se evalúa siempre, incluso en un probe: es lo que le permite a
            // la adaptación de templates exigir calidad de registro sin pagar
            // una segunda detección (~1s).
            meetsEnrollmentProfile:
              findFaceQualityProblem(metrics, getFaceQualityProfile(this.detector, 'enrollment')) === null,
          },
        };
      } finally {
        tf.dispose(faceTensor);
      }
    } finally {
      tf.dispose(tensor);
    }
  }

  compare(a: BiometricDescriptor, b: BiometricDescriptor): BiometricCompareResult {
    const distance = faceapi.euclideanDistance(a.vector, b.vector) as number;
    return { distance, isMatch: distance <= this.matchThreshold };
  }

  private async readImage(imageBuffer: Buffer): Promise<JimpImage> {
    try {
      return await Jimp.read(imageBuffer);
    } catch {
      throw new InvalidBiometricInputError('El archivo no es una imagen válida.');
    }
  }

  /** Nitidez del rostro: recorte → 128x128 → escala de grises → varianza del Laplaciano. */
  private async measureSharpness(image: JimpImage, box: { x: number; y: number; width: number; height: number }): Promise<number> {
    const x = Math.max(0, Math.round(box.x));
    const y = Math.max(0, Math.round(box.y));
    const w = Math.min(image.bitmap.width - x, Math.round(box.width));
    const h = Math.min(image.bitmap.height - y, Math.round(box.height));
    if (w < 3 || h < 3) {
      return 0;
    }

    const sample = image
      .clone()
      .crop({ x, y, w, h })
      .resize({ w: SHARPNESS_SAMPLE_SIZE, h: SHARPNESS_SAMPLE_SIZE })
      .greyscale();
    const { data } = sample.bitmap;
    const gray = new Float32Array(SHARPNESS_SAMPLE_SIZE * SHARPNESS_SAMPLE_SIZE);
    for (let i = 0; i < gray.length; i++) {
      gray[i] = data[i * 4];
    }
    return laplacianVariance(gray, SHARPNESS_SAMPLE_SIZE, SHARPNESS_SAMPLE_SIZE);
  }

  private imageToTensor(image: JimpImage) {
    const { data, width, height } = image.bitmap; // RGBA
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
      rgb[j] = data[i];
      rgb[j + 1] = data[i + 1];
      rgb[j + 2] = data[i + 2];
    }
    return tf.tensor3d(rgb, [height, width, 3], 'int32');
  }
}
