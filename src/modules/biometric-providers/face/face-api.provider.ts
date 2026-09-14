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
  InvalidBiometricInputError,
} from '../biometric-provider.interface';

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
  private modelsLoaded = false;
  private detectorOptions: any;

  constructor(configService: ConfigService) {
    const biometrics = configService.get<AppConfig['biometrics']>('biometrics')!;
    this.matchThreshold = biometrics.faceMatchThreshold;
    this.modelsPath = path.resolve(process.cwd(), biometrics.faceModelsPath);
  }

  async onModuleInit(): Promise<void> {
    const wasmDir = path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm'));
    wasm.setWasmPaths(wasmDir + path.sep);
    await tf.setBackend('wasm');
    await tf.ready();

    await faceapi.nets.tinyFaceDetector.loadFromDisk(this.modelsPath);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(this.modelsPath);
    await faceapi.nets.faceRecognitionNet.loadFromDisk(this.modelsPath);

    this.detectorOptions = new faceapi.TinyFaceDetectorOptions();
    this.modelsLoaded = true;
    this.logger.log(`Modelos de reconocimiento facial cargados desde ${this.modelsPath} (backend: ${tf.getBackend()})`);
  }

  async extractDescriptor(imageBuffer: Buffer): Promise<BiometricDescriptor> {
    if (!this.modelsLoaded) {
      throw new Error('FaceApiProvider: los modelos todavía no terminan de cargar.');
    }

    const tensor = await this.bufferToTensor(imageBuffer);
    try {
      const result = await faceapi.detectSingleFace(tensor, this.detectorOptions).withFaceLandmarks().withFaceDescriptor();
      if (!result) {
        throw new BiometricDetectionError('No se detectó ningún rostro en la imagen.');
      }
      return { vector: Array.from(result.descriptor as Float32Array) };
    } finally {
      tf.dispose(tensor);
    }
  }

  compare(a: BiometricDescriptor, b: BiometricDescriptor): BiometricCompareResult {
    const distance = faceapi.euclideanDistance(a.vector, b.vector) as number;
    return { distance, isMatch: distance <= this.matchThreshold };
  }

  private async bufferToTensor(imageBuffer: Buffer) {
    let image;
    try {
      image = await Jimp.read(imageBuffer);
    } catch {
      throw new InvalidBiometricInputError('El archivo no es una imagen válida.');
    }
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
