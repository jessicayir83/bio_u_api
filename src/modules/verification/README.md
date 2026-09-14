# VerificationModule (Fase 5 — completo: Face real + Fingerprint mock)

Verificación 1:1 usando la interfaz genérica `BiometricProvider`
(`api/src/modules/biometric-providers/biometric-provider.interface.ts`).

- `POST /verification/faces/:personId` (multipart, campo `image`;
  `JwtAuthGuard`+`RolesGuard`+`@Roles('Admin','Operator')`): compara
  contra el `Template` `Face` más reciente de la persona.
- `POST /verification/fingerprints/:personId` (mismo formato/guards):
  compara contra el `Template` `Fingerprint` más reciente — usa
  `MockFingerprintProvider` (sin lector físico todavía, ver
  `biometric-providers/fingerprint/README.md`).

Ambos responden `{ personId, modality, isMatch, distance, threshold }`.
404 si la persona no existe o no tiene template de esa modalidad; 400 si
la muestra no es válida.
