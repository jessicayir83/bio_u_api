# PersonsModule (Fase 3 — implementado)

Entidades (`entities/`, schema `identity`): `BiometricPersonEntity`
(cédula, nombre, apellido, fecha de nacimiento, `isActive`),
`PersonIdentifierEntity` (identificadores secundarios: código de
empleado, pasaporte, etc. — no la cédula, que vive en
`BiometricPerson.nationalId`).

Endpoints (`persons.controller.ts`), todos requieren `JwtAuthGuard`;
escritura además `RolesGuard` + `@Roles('Admin', 'Operator')` (lectura
abierta a cualquier usuario autenticado, incluido `Auditor`):

- `POST /persons`
- `GET /persons` (`?search=` sobre cédula/apellido)
- `GET /persons/:id` (incluye `identifiers[]`)
- `PATCH /persons/:id`
- `DELETE /persons/:id` — **soft delete** (`isActive = false`), nunca
  borra el registro físicamente.
- `POST /persons/:id/identifiers`
- `DELETE /persons/:id/identifiers/:identifierId` — este sí borra
  físicamente (es solo un identificador secundario).

`PersonsModule` exporta `TypeOrmModule` para que `EnrollmentModule`
reutilice el repositorio de `BiometricPersonEntity` al validar que un
`personId` exista.
