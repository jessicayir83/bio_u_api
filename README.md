# Bio U — API (NestJS)

Backend de Bio U: NestJS + TypeScript + TypeORM sobre SQL Server. Reconocimiento
facial en servidor (`@vladmandic/face-api` sobre WASM). Guía general del proyecto en
el `README.md` de la raíz; reglas para sesiones de Claude en `CLAUDE.md`.

## Arranque

```bash
cp .env.example .env     # completar DB_*, JWT_SECRET y ENCRYPTION_KEY (ver comentarios)
npm install
npm run start:dev        # http(s)://localhost:5001
npm run typecheck        # tsc --noEmit
npm run check:routes     # verifica que TODA ruta declare su política de acceso (ver abajo)
```

La base se crea con los scripts numerados de `../bio_u_db/` (los ejecuta Jess a mano).
Nunca `synchronize: true`.

---

## Normas de seguridad obligatorias

Cualquier persona que toque este repo tiene que respetarlas. Un cambio que las viole
no se acepta, aunque funcione. Cada norma explica **qué pasa si se rompe**.

### 1. Nunca confíes en lo que manda el cliente (IDOR)

Un id de la URL, del body o del query es **una afirmación del usuario, no un hecho**.
Quién actúa sale **siempre del JWT** (`@CurrentUser()`), nunca de un `userId`/`createdByUserId`
que venga en la petición. Además del rol, comprobá si el usuario puede operar sobre
**ese** objeto.

```ts
// MAL: cualquier Operator opera sobre el enrollment de otro, solo con cambiar el :id
capture(@Param('id') id: number) { return this.service.capture(id, ...); }

// BIEN: el service comprueba el dueño con el usuario del token
capture(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
  return this.service.capture(id, ..., user);   // dentro: assertCanActOnOwned(user, enrollment.createdByUserId)
}
```

Helper reutilizable: `src/common/authorization/ownership.ts` (`assertCanActOnOwned`).
Los ids son enteros secuenciales y por lo tanto adivinables: **la autorización nunca puede
apoyarse en que el id sea difícil de adivinar**.

### 2. Deny-by-default: toda ruta declara su política

`JwtAuthGuard` y `RolesGuard` son **globales** (`app.module.ts`). Una ruta sin política
responde **403**. Cada endpoint debe llevar exactamente una de:

| Decorador | Significa |
|---|---|
| `@Roles('Admin', 'Operator')` | sesión válida + uno de esos roles (a nivel de método o de clase) |
| `@AnyAuthenticated()` | cualquier sesión válida; solo para datos **propios** (`/auth/me`, `logout`, `change-password`) |
| `@Public()` | sin sesión. Solo login/refresh, `/health` y `KioskController` |

No pongas `@UseGuards(JwtAuthGuard)` a mano: ya está aplicado y se ejecutaría dos veces.
**Antes de cerrar cualquier cambio que agregue o modifique endpoints, corré
`npm run check:routes`**: lista todas las rutas con su política y falla si alguna no tiene.
`api/src/modules/kiosk/` es la única superficie pública; un endpoint público nuevo hay que
justificarlo por escrito, con `@RateLimit` y devolviendo datos mínimos.

La sesión se revalida contra la base **en cada request** (`JwtStrategy.validate`): los roles del
token se ignoran, así que desactivar a un usuario o quitarle un rol surte efecto de inmediato.

### 3. Mass assignment: nunca asignes el body a una entidad

Todo `@Body()` es un **DTO con decoradores de `class-validator`**. El `ValidationPipe` global
(`whitelist` + `forbidNonWhitelisted`) rechaza con 400 cualquier propiedad que el DTO no declare:
no lo desactives ni lo debilites.

```ts
// MAL: si el body trae { "isActive": true, "roleIds": [1] } o cualquier campo de la entidad, se escribe
Object.assign(user, body);        // o repository.update(id, body) / save({ ...body })
@Body() body: any

// BIEN: DTO tipado + asignación explícita campo a campo
if (dto.fullName !== undefined) user.fullName = dto.fullName;
```

- Los campos de privilegio o autoría (`roleIds`, `isActive`, `createdByUserId`, `passwordHash`,
  `failedAttempts`, `lockedUntil`, `revokedAt`…) **solo** pueden existir en DTOs de endpoints
  restringidos a Admin. Los `*ByUserId` salen del token.
- Nunca uses `any`, `Record<string, unknown>` ni la entidad como tipo de `@Body()`.
- Tampoco devuelvas entidades completas al cliente en endpoints públicos: armá un objeto con los
  campos que hacen falta (ver `KioskService`).

### 4. Errores: nunca filtres detalles internos (Verbose Errors)

Un stack trace, un nombre de tabla o una ruta de archivo en la respuesta le regalan al atacante
cómo está armado el sistema. El filtro global `AuditExceptionFilter` ya lo resuelve; no lo saltees:

- Toda excepción que **no** sea una `HttpException` 4xx (errores de SQL/TypeORM, de TensorFlow,
  bugs) se responde `500` con `{ statusCode, message: "Algo salió mal…", correlationId }`.
  La causa real va **solo** al log del servidor y a la bitácora de auditoría.
- Para errores esperados lanzá `BadRequestException`/`ConflictException`/etc. con un **mensaje
  literal escrito por vos**. Nunca `throw new BadRequestException(err.message)` con un `err`
  que no sea de un tipo propio (`BiometricDetectionError`, `InvalidBiometricInputError`…): ese
  mensaje puede venir de una librería.
- No hagas `try { … } catch (e) { return { error: e.message } }`. No devuelvas `e.stack`.
- Un `correlationId` en la respuesta es lo que permite a soporte encontrar la causa en `/audit`.

### 5. Rate limit en todo

El guard global `AppThrottlerGuard` limita por IP y por ruta. Cada ruta elige una política con
`@RateLimit('auth' | 'passwordChange' | 'biometric' | 'export' | 'kiosk' | 'kioskRegister')`;
sin decorador aplica `default`. **Los números viven en `src/config/configuration.ts`
(`THROTTLE_*`)**, nunca literales en un controller.

- Endpoint nuevo que cueste CPU (reconocimiento, exportes) o que sea público: política propia, baja.
- Las subidas de archivos llevan `limits: IMAGE_UPLOAD_LIMITS` (`src/common/uploads/`) para que
  multer corte el archivo antes de cargarlo entero en memoria.
- La extracción facial pasa por un limitador de concurrencia (`FACE_MAX_CONCURRENCY`): no la llames
  por fuera de `FaceApiProvider.extractDescriptor`.
- Las cuentas se bloquean 15 min tras 5 contraseñas incorrectas (`AUTH_LOCKOUT_*`). La respuesta de
  login es **idéntica** exista o no el usuario, esté bloqueado o no: no la diferencies.

### 6. Auditoría sin datos personales

Toda operación de negocio nueva anota su evento con `auditService.annotate(...)` (tipos en
`audit.constants.ts`). Nunca pongas en `details`/`message`: contraseñas, tokens, fotos, descriptores,
cédulas, nombres ni fechas de nacimiento — solo ids y nombres de campos. Detalle en
`src/modules/audit/README.md`.

### 7. Base de datos

- Consultas siempre con TypeORM parametrizado (`find`, `QueryBuilder` con parámetros). **Nunca**
  concatenes valores en un string SQL.
- Cambios de estructura = script numerado en `../bio_u_db/`, idempotente. Nunca `synchronize: true`.
- Consultas de templates para reconocer filtran `revokedAt: IsNull()`.

### 8. Configuración y secretos

Todo por `ConfigService` / `AppConfig`. Ningún archivo, salvo `configuration.ts`, lee `process.env`.
Variable nueva ⇒ también en `.env.example`, sin secretos reales. Nada de credenciales ni URLs en el código.

### Checklist antes de dar por terminado un endpoint

- [ ] ¿Lleva `@Roles`/`@AnyAuthenticated`/`@Public` y pasa `npm run check:routes`?
- [ ] ¿El actor sale del JWT y se comprueba el dueño del objeto cuando hace falta?
- [ ] ¿El body es un DTO validado, sin `Object.assign` ni `any`?
- [ ] ¿Los errores son mensajes propios, sin `err.message` de terceros?
- [ ] ¿Tiene `@RateLimit` si es público o costoso?
- [ ] ¿Anota su evento de auditoría, sin datos personales?
- [ ] ¿`npm run typecheck` pasa?
