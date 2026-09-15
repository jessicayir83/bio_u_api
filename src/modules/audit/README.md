# AuditModule (Fase 9 — auditoría)

Registra **todo lo que pasa en el API** en `audit.AuditEvent`
(`bio_u_db/06_create_audit_tables.sql`), clasificado por severidad, y
expone el dashboard de consulta (solo `Admin`).

## Cómo se registra

1. **Cada request HTTP** — `createAuditHttpMiddleware` (montado en
   `main.ts` con `app.use`, antes de los parsers de body) abre un contexto
   por request (`AsyncLocalStorage`, `audit-context.ts`) y escribe **una
   fila** cuando la respuesta termina: IP, user agent, método, ruta (sin
   query string), status, duración, usuario del JWT y un `CorrelationId`
   (también devuelto en el header `X-Request-Id`). Se omiten solo los
   `OPTIONS` (preflight CORS).
2. **Semántica de negocio** — los servicios llaman
   `AuditService.annotate({ eventType, targetType, targetId, details })`
   para que esa fila diga *qué* pasó (ej. `PERSON_UPDATED` sobre la
   persona 12) en vez de un genérico `HTTP_REQUEST`. Fuera de un request,
   `annotate` escribe directamente.
3. **Errores** — `AuditExceptionFilter` (global, `APP_FILTER`) guarda el
   error del request y deja que Nest responda igual que siempre. Un 5xx
   pisa lo anotado (`SYSTEM_ERROR`, `SYSTEM_DATABASE_ERROR`, o
   `SECURITY_TEMPLATE_INTEGRITY_FAILURE` si AES-GCM rechaza un template).
4. **Detección de anomalías** — `AuditAnomalyDetector` observa cada evento
   escrito y genera alertas derivadas (ventanas deslizantes en memoria):

   | Alerta | Severidad | Regla (configurable en `.env`) |
   |---|---|---|
   | `SECURITY_LOGIN_BURST` | SEV1 | ≥10 `POST /auth/login` de una IP en 60 s |
   | `SECURITY_KIOSK_BURST` | SEV1 | ≥10 intentos de ingreso/registro del kiosco de una IP en 60 s (sin contar los rechazos por calidad del ingreso en vivo, que reintenta solo) |
   | `SECURITY_RATE_LIMIT_BURST` | SEV1 | ≥10 respuestas 429 a una IP en 60 s |
   | `SECURITY_AUTH_FAILURE_BURST` | SEV1 | ≥10 respuestas 401/403 (no por token vencido) a una IP en 60 s |
   | `SECURITY_ROUTE_SCANNING` | SEV1 | ≥20 respuestas 404 a una IP en 60 s |
   | `SECURITY_ACCOUNT_REPEATED_LOGIN_FAILURE` | SEV2 | ≥5 logins fallidos de una misma cuenta en 10 min |
   | `SECURITY_KIOSK_REGISTER_REPEATED_FAILURE` | SEV2 | ≥5 registros del kiosco rechazados (rostro/fotos) de una IP en 10 min |
   | `SECURITY_KIOSK_CHECKIN_REPEATED_FAILURE` | SEV2 | ≥5 ingresos no reconocidos/ambiguos de una IP en 10 min |

   Una alerta por ventana por clave. Limitación: los contadores viven en
   memoria (se reinician con el API y no se comparten entre instancias).
5. **Sistema** — `SYSTEM_STARTUP` (desde `main.ts`, tras `listen`) y
   `SYSTEM_SHUTDOWN` (solo ante una señal del proceso).

Catálogo completo de tipos, severidades y descripciones:
`audit.constants.ts`.

## Qué nunca se guarda

Contraseñas, tokens, fotos, descriptores/templates ni **valores de datos
personales** (cédula, nombres, fecha de nacimiento, valor de
identificadores). `audit-sanitizer.ts` redacta esas claves en `Details`;
los cambios sobre personas guardan el id y los **nombres** de los campos
modificados; las búsquedas guardan solo que hubo búsqueda; la query string
solo sus claves. Los mensajes de error de SQL Server con "Truncated value"
se redactan.

## Si falla la base

Un evento que no se puede insertar (ej. script 06 sin ejecutar, base
caída) se agrega a `AUDIT_FALLBACK_FILE` (default
`logs/audit-fallback.jsonl`, en `.gitignore`). Una falla de auditoría
nunca rompe la operación auditada.

## Inmutabilidad

`audit.AuditEvent` rechaza `UPDATE`/`DELETE` por trigger. El servicio solo
usa `insert`. Marcar una alerta como revisada agrega una fila en
`audit.AlertAcknowledgement` (y un evento `AUDIT_ALERT_ACKNOWLEDGED`).

## Endpoints (JwtAuthGuard + RolesGuard, `@Roles('Admin')`)

- `GET /audit/summary?hours=24` — conteos por severidad, línea de tiempo
  por hora, IPs y tipos de evento más frecuentes, alertas SEV1/SEV2 sin
  revisar.
- `GET /audit/events` — listado paginado con filtros (`severity=SEV1,SEV2`,
  `category`, `eventType`, `outcome`, `sourceIp`, `actor`, `actorUserId`,
  `targetType`, `targetId`, `correlationId`, `from`, `to`, `search`,
  `acknowledged`, `page`, `pageSize`).
- `GET /audit/events/:id` — detalle + eventos del mismo request.
- `POST /audit/events/:id/acknowledge` — `{ note? }`, solo SEV1/SEV2.
- `GET /audit/events/export` — CSV (mismos filtros, máx. 10.000 filas,
  protegido contra inyección de fórmulas). Queda auditado como SEV3.
- `GET /audit/catalog` — tipos de evento para los filtros.

Consultar la auditoría también queda auditado (`AUDIT_VIEWED`).

## Agregar eventos nuevos

1. Agregar el tipo en `AUDIT_EVENT_TYPES` (categoría, severidad por
   defecto, resultado, descripción).
2. Llamar `auditService.annotate({ eventType: 'NUEVO_TIPO', ... })` en el
   servicio, después de que la operación tuvo éxito (o justo antes de
   lanzar la excepción, para los fallos).
