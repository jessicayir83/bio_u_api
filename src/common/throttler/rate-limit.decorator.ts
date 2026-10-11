import { SetMetadata } from '@nestjs/common';
import type { RateLimitPolicy } from '../../config/configuration';

export const RATE_LIMIT_KEY = 'rateLimitPolicy';

/**
 * Asigna a la ruta (o al controller) una política de rate limit con nombre.
 * Los números viven en `config/configuration.ts` (`throttle`, variables
 * `THROTTLE_*`): nunca poner límites literales en un controller.
 * Sin decorador aplica el límite `default` del API (por IP y por ruta).
 */
export const RateLimit = (policy: RateLimitPolicy) => SetMetadata(RATE_LIMIT_KEY, policy);
