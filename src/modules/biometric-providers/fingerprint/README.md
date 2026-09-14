# MockFingerprintProvider (Fase 5 — implementado, mock)

Implementación de `BiometricProvider` (`../biometric-provider.interface.ts`)
sin lector físico todavía. **No hace matching biométrico real**: hashea
la muestra recibida (SHA-256) y compara igualdad exacta —
`isMatch: true` solo si se sube exactamente el mismo archivo dos veces.
Sirve para validar el flujo completo (enrollment → captura →
verificación) antes de integrar un SDK real cuando se consiga hardware
(Fase 6). Ver `plan_implementation` para la nota sobre SDKs propietarios
de lectores de huella.

Token DI: `FINGERPRINT_PROVIDER` (vía `FingerprintProviderModule`), mismo
patrón que `FACE_PROVIDER`.
