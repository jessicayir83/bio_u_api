# FaceProvider (Fase 5 — implementado)

Implementa la interfaz genérica `BiometricProvider`
(`../biometric-provider.interface.ts`, compartida con
`fingerprint/MockFingerprintProvider`) — `FaceApiProvider`
(`face-api.provider.ts`) con
`@vladmandic/face-api` sobre un backend **100% JS/WASM**
(`@tensorflow/tfjs` + `@tensorflow/tfjs-backend-wasm`, sin `tfjs-node` ni
`canvas`). Decisión tomada tras confirmar que `@tensorflow/tfjs-node`
tiene un historial recurrente de binarios precompilados rotos en
Windows — mismo criterio que `bcryptjs` en Fase 2.

La imagen se decodifica con `jimp` (puro JS) y se arma el tensor a mano
(`tf.tensor3d`), sin pasar por `canvas`/`tf.node.decodeImage`.

Modelos usados (en `api/models/`, copiados del paquete/repo de
`vladmandic/face-api`): detector `ssd_mobilenetv1` (default) o
`tiny_face_detector` (`FACE_DETECTOR=tiny`), `face_landmark_68`,
`face_recognition` (descriptor de 128 dimensiones). Ruta configurable vía
`FACE_MODELS_PATH`. Cambiar de detector altera los descriptores (~0.15-0.2
de distancia sobre la misma foto): reenrolar después del cambio.

Umbral de coincidencia (distancia euclidiana): `FACE_MATCH_THRESHOLD`
(default `0.6`, el recomendado por face-api.js). Calibrarlo con datos
reales: `npm run calibrate:face` (`src/scripts/calibrate-face.ts`).

## Controles de calidad (`face-quality.ts`)

Antes de calcular el descriptor se rechaza (con `BiometricQualityError`,
mensaje pensado para la persona) si hay más de un rostro de tamaño
comparable, si la cara es muy chica, con baja confianza, girada (yaw por
nariz vs. mandíbula), inclinada (roll por los ojos) o borrosa (varianza del
Laplaciano del recorte a 128x128). Dos perfiles:

| | enrollment (se guarda) | probe (verificar/identificar) |
|---|---|---|
| Ancho mínimo | 100 px | 70 px |
| Confianza SSD / Tiny | 0.85 / 0.7 | 0.7 / 0.5 |
| Giro (yaw) máx. | 0.12 | 0.2 |
| Inclinación máx. | 20° | 30° |
| Nitidez mín. | 35 | 20 |

Cada extracción deja una línea `debug` con las métricas, útil para
ajustar estos valores con capturas reales.

`FaceProviderModule` expone el provider bajo el token `FACE_PROVIDER`
para que `EnrollmentModule`/`VerificationModule` lo inyecten sin acoplarse
a la implementación concreta. Ver `../fingerprint/README.md` para el
segundo proveedor (mock, huella).
