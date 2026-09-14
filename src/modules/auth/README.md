# AuthModule (Fase 2 — implementado)

Entidades (`entities/`, schema `security`): `UserEntity`, `RoleEntity`,
`UserRoleEntity` (puente many-to-many), `ClientApplicationEntity` (solo
estructura, Fase 8 la activa), `RefreshTokenEntity`.

Endpoints (`auth.controller.ts`):
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout` (requiere `JwtAuthGuard`)
- `GET /auth/me` (auxiliar temporal, requiere `JwtAuthGuard`)
- `GET /auth/admin-only` (auxiliar temporal, requiere `JwtAuthGuard` + `RolesGuard` + `@Roles('Admin')`)

Los dos endpoints auxiliares se pueden retirar cuando un módulo real de
Fase 3+ los reemplace como ejemplo de uso de los guards.

Diseño de tokens: el access token es un JWT (`@nestjs/jwt`), el refresh
token es un string aleatorio opaco (`crypto.randomBytes`) del cual solo se
persiste su SHA-256 en `security.RefreshToken`, con rotación y detección
de reuso (ver `auth.service.ts`).

Para usar `JwtAuthGuard`/`RolesGuard` en otros módulos:
`@UseGuards(JwtAuthGuard, RolesGuard) @Roles('Admin')`.
