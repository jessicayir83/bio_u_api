import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';
import { AuditService } from '../../audit/audit.service';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const user = context.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
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
