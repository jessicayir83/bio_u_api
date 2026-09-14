# EnrollmentModule (Fase 3 estructura, Fase 5 captura real)

Entidades (`entities/`, schema `biometric`): `EnrollmentEntity` —
`personId`, `modality` (texto libre: `Face`, `Fingerprint`, etc.),
`status` (`Pending` | `Completed` | `Revoked`), `createdByUserId`,
`completedAt`. `TemplateEntity` — resultado de una captura (`personId`,
`enrollmentId`, `modality`, `vectorJson` sin cifrar — Fase 7 cifra).

Endpoints (`enrollment.controller.ts`), mismas reglas de guards que
`PersonsModule` (`JwtAuthGuard` base, escritura + `RolesGuard` +
`@Roles('Admin', 'Operator')`):

- `POST /enrollments` — valida que `personId` exista y esté activo.
- `GET /enrollments` (`?personId=&status=`)
- `GET /enrollments/:id`
- `PATCH /enrollments/:id/status` — `Completed` | `Revoked`.
- `POST /enrollments/:id/capture` (multipart, campo `image`) — genérico
  por modalidad: usa el `BiometricProvider` (`../biometric-providers/`)
  correspondiente a `enrollment.modality` (`Face` → `FaceProvider`,
  `Fingerprint` → `MockFingerprintProvider`), guarda el `Template` y
  marca `Completed`. 400 si la modalidad no tiene provider registrado.

Importa `PersonsModule`, `FaceProviderModule` y
`FingerprintProviderModule`.
