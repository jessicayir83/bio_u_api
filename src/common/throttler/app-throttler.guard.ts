import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerGenerateKeyFunction,
  type ThrottlerGetTrackerFunction,
  type ThrottlerModuleOptions,
  type ThrottlerOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import type { ExecutionContext } from '@nestjs/common';
import type { AppConfig, RateLimitPolicy } from '../../config/configuration';
import { RATE_LIMIT_KEY } from './rate-limit.decorator';

/**
 * Guard global de rate limit. Igual que `ThrottlerGuard`, pero el límite de cada
 * ruta sale de la política con nombre (`@RateLimit('auth')`) definida en la
 * configuración. La clave es la IP del cliente (`req.ip`, ver `trustProxy`) + la ruta.
 *
 * Corre ANTES de la autenticación a propósito: así frena fuerza bruta y floods
 * sin gastar una consulta a la base por cada request.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly configService: ConfigService,
  ) {
    super(options, storageService, reflector);
  }

  protected async handleRequest(
    context: ExecutionContext,
    limit: number,
    ttl: number,
    throttler: ThrottlerOptions,
    getTracker: ThrottlerGetTrackerFunction,
    generateKey: ThrottlerGenerateKeyFunction,
  ): Promise<boolean> {
    const policy = this.reflector.getAllAndOverride<RateLimitPolicy | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (policy) {
      const throttle = this.configService.get<AppConfig['throttle']>('throttle')!;
      limit = throttle[policy];
      ttl = throttle.ttlSeconds * 1000;
    }
    return super.handleRequest(context, limit, ttl, throttler, getTracker, generateKey);
  }
}
