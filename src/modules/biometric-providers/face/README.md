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

Modelos usados (en `api/models/`, descargados del repo de
`vladmandic/face-api`): `tiny_face_detector`, `face_landmark_68`,
`face_recognition` (descriptor de 128 dimensiones). Ruta configurable vía
`FACE_MODELS_PATH`.

Umbral de coincidencia (distancia euclidiana): `FACE_MATCH_THRESHOLD`
(default `0.6`, el recomendado por face-api.js).

`FaceProviderModule` expone el provider bajo el token `FACE_PROVIDER`
para que `EnrollmentModule`/`VerificationModule` lo inyecten sin acoplarse
a la implementación concreta. Ver `../fingerprint/README.md` para el
segundo proveedor (mock, huella).
