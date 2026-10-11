import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../modules/auth/interfaces/jwt-payload.interface';

/**
 * Control de acceso por objeto (ABAC): el rol dice QUÉ tipo de operación puede hacer
 * alguien; esto dice si puede hacerla sobre ESTE objeto. Regla: Admin sobre cualquiera,
 * el resto solo sobre lo que creó.
 *
 * Se llama desde el service (no el controller) y con el `user` que viene del JWT,
 * nunca con un id que mande el cliente.
 */
export function canActOnOwned(user: AuthenticatedUser, ownerUserId: number | null | undefined): boolean {
  return user.roles.includes('Admin') || (ownerUserId != null && ownerUserId === user.userId);
}

/** Lanza 403 con mensaje genérico (no revela de quién es el objeto). */
export function assertCanActOnOwned(user: AuthenticatedUser, ownerUserId: number | null | undefined, onDenied?: () => void): void {
  if (!canActOnOwned(user, ownerUserId)) {
    onDenied?.();
    throw new ForbiddenException('No tiene permiso para operar sobre este registro.');
  }
}
