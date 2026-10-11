import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { ANY_AUTHENTICATED_KEY, IS_PUBLIC_KEY } from '../decorators/access.decorator';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';
import { AuditService } from '../../audit/audit.service';

/**
 * Guard global (APP_GUARD, corre después de `JwtAuthGuard`). Deny-by-default:
 * una ruta sin `@Public()`, `@AnyAuthenticated()` ni `@Roles(...)` se rechaza
 * con 403, así una ruta nueva a la que se le olvidó la política nunca queda abierta.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const user = context.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, targets);

    if (!requiredRoles || requiredRoles.length === 0) {
      if (this.reflector.getAllAndOverride<boolean>(ANY_AUTHENTICATED_KEY, targets) && user) {
        return true;
      }
      this.auditService.annotate({
        eventType: 'AUTH_ACCESS_DENIED_NO_POLICY',
        details: { handler: `${context.getClass().name}.${context.getHandler().name}` },
      });
      throw new ForbiddenException('No tiene permiso para esta operación.');
    }

    const hasRole = !!user && requiredRoles.some((role) => user.roles.includes(role));

    if (!hasRole) {
      this.auditService.annotate({
        eventType: 'AUTH_ACCESS_DENIED_ROLE',
        details: { requiredRoles, userRoles: user?.roles ?? [] },
      });
      throw new ForbiddenException('No tiene el rol requerido para esta operación.');
    }

    return true;
  }
}
