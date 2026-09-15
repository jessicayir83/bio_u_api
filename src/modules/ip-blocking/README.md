# IpBlockingModule (Fase 9 — bloqueo manual de IPs)

Un Admin bloquea desde el dashboard de auditoría la IP de origen de una
**alerta de intentos fallidos o alarmantes**. Mientras el bloqueo esté
activo, el API responde **403** a cualquier request de esa IP (panel,
login, kiosco).

- Tabla: `security.BlockedIp` (`bio_u_db/07_create_blocked_ip_table.sql`).
  Historial completo; un solo bloqueo activo por IP (índice único filtrado).
- **Solo desde alertas bloqueables** (`BLOCKABLE_ALERT_TYPES` en
  `audit/audit.constants.ts`): ráfagas de login/kiosco/401-403/rate limit,
  fallos repetidos de cuenta o del kiosco, y rostro registrado con otra
  cédula. **No** escaneo de rutas ni reuso de refresh token. La IP se toma
  de la alerta (el Admin no la escribe).
- Nunca se bloquea `127.x` / `::1` ni la IP del propio Admin que bloquea.
- Duración: 1 h, 24 h, 7 días, 30 días o sin vencimiento.
- Bloquear marca la alerta como revisada.
- Enforcement: `createIpBlockMiddleware` en `main.ts`, después del de
  auditoría (el intento rechazado queda como `SECURITY_BLOCKED_IP_REQUEST`,
  que no dispara nuevas alertas de ráfaga). Consulta un caché en memoria
  que se relee de la tabla tras cada cambio y cada 60 s.
- Auditoría: `SECURITY_IP_BLOCKED` (SEV2), `SECURITY_IP_UNBLOCKED` (SEV3).

## Endpoints (solo Admin)

- `GET /ip-blocks` — últimos 50 (activos, vencidos, levantados).
- `POST /ip-blocks` — `{ sourceAuditEventId, reason, durationHours? }`.
- `POST /ip-blocks/:id/unblock` — `{ reason? }`.

## Desbloqueo de emergencia (por SQL)

Ver el comentario al inicio de `07_create_blocked_ip_table.sql`. El API
toma el cambio en menos de 1 minuto.
