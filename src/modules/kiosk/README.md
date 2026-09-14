# KioskModule — ÚNICA superficie pública del API

**Atención**: estos son los únicos endpoints del proyecto **sin
autenticación** (decisión explícita del usuario: el kiosco es de
autoservicio, cualquiera se para frente a la cámara). Todo lo demás sigue
detrás de `JwtAuthGuard`. Cualquier endpoint nuevo que se agregue acá
debe justificarse — es la cara expuesta del sistema.

Mitigaciones aplicadas:
- Límite de intentos por IP (`@Throttle`): 30/min general y **5/min en
  `/kiosk/register`** (crear personas es lo sensible). El 30 no es
  arbitrario: la pantalla de "Ingresar" detecta el rostro en vivo y
  reintenta sola cada ~4-6s, así que un límite más bajo cortaría un uso
  legítimo. Sigue siendo barrera efectiva — cada request cuesta 1-3s de
  CPU a quien la haga.
- **Respuestas mínimas**: solo `id`, `firstName`, `lastName`. Nunca la
  cédula, ni listados, ni distancias en `identify`.
- Pendiente antes de producción (ver `plan_implementation`): restringir a
  la red local o exigir un token de kiosco (Fase 8, Device Gateway).

## Endpoints

- `POST /kiosk/identify` (multipart `image`) — identificación 1:N.
  Responde `{ matched, person?, ambiguous? }`. Lo usa "Registrarme" para
  no duplicar personas.
- `POST /kiosk/register` (multipart `images` ×1-3 + `nationalId`,
  `firstName`, `lastName`, `dateOfBirth?`) — 409 si la cara o la cédula
  ya existen; 400 si ninguna foto tiene rostro detectable. Crea persona +
  enrollment `Face` `Completed` + un `Template` por foto válida (varios
  templates mejoran el match posterior).
- `POST /kiosk/check-in` (multipart `image`) — identifica y graba
  `biometric.AccessLog` (concedido o denegado). Responde
  `{ granted, person?, distance? }`.

## Usuario de sistema `kiosk`

`identity.BiometricPerson.CreatedByUserId` es NOT NULL, pero en el kiosco
no hay usuario logueado. El script `database/05_create_access_log_table.sql`
siembra un usuario `kiosk` (`IsActive = 0`, sin roles, sin hash válido —
no puede iniciar sesión) que queda como autor de esos registros.
`KioskService` lo resuelve por username y cachea su id.
