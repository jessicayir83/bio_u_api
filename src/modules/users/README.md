# UsersModule (Fase 4 — implementado)

Gestión administrativa de `security.User`/`Role`/`UserRole` (las
entidades viven en `api/src/modules/auth/entities/`, reutilizadas vía
`AuthModule` que exporta `TypeOrmModule`). Todo exclusivo de rol `Admin`
(`JwtAuthGuard` + `RolesGuard` + `@Roles('Admin')`).

Endpoints:
- `GET /roles` (`roles.controller.ts`) — lista de roles para poblar el
  selector del frontend.
- `POST /users` — crea usuario + asigna roles (`roleIds`), hashea con
  `bcryptjs`.
- `GET /users`, `GET /users/:id`
- `PATCH /users/:id` — actualiza `fullName`/`email`; si llega `roleIds`,
  reemplaza el set completo de roles.
- `DELETE /users/:id` — soft delete (`isActive = false`).
- `POST /users/:id/activate` — reactiva.

No incluye reseteo de password por Admin (fuera de alcance de Fase 4).
