import { SetMetadata } from '@nestjs/common';

/**
 * Política de acceso: el API es "deny-by-default". Los guards globales
 * (`JwtAuthGuard` + `RolesGuard`, registrados en `AppModule`) exigen que TODA ruta
 * declare una de estas tres cosas; una ruta sin ninguna responde 403:
 *
 *  - `@Roles('Admin', ...)`  → sesión válida + uno de esos roles (ver roles.decorator.ts).
 *  - `@AnyAuthenticated()`   → sesión válida, sin exigir rol (solo para datos propios:
 *                              `/auth/me`, `/auth/logout`, `/auth/change-password`).
 *  - `@Public()`             → sin sesión. Reservado para login/refresh, health y el
 *                              kiosco (`KioskController`); toda ruta nueva pública debe justificarse.
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ANY_AUTHENTICATED_KEY = 'anyAuthenticated';
export const AnyAuthenticated = () => SetMetadata(ANY_AUTHENTICATED_KEY, true);
