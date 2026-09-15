import type { AppConfig } from '../../config/configuration';
import type { AuditEventType } from './audit.constants';

/** Lo mínimo de un evento ya registrado que necesitan las reglas. */
export interface ObservedAuditEvent {
  eventType: string;
  sourceIp: string | null;
  httpMethod: string | null;
  path: string | null;
  statusCode: number | null;
  actorUsername: string | null;
  correlationId: string | null;
}

export interface AnomalyAlert {
  eventType: AuditEventType;
  sourceIp: string | null;
  actorUsername: string | null;
  correlationId: string | null;
  details: Record<string, unknown>;
}

interface Rule {
  alert: AuditEventType;
  /** Clave del contador (ej. IP o cuenta), o null si el evento no aplica a la regla. */
  keyOf: (event: ObservedAuditEvent) => string | null;
  threshold: number;
  windowMs: number;
}

const KIOSK_ATTEMPT_PATH = /^\/kiosk\/(identify|check-in|register)$/;
// Rechazos por calidad del ingreso en vivo: la cámara reintenta sola cada ~4s
// mientras la persona se acomoda, así que no cuentan como "intento".
const KIOSK_LIVE_HINT_EVENTS = new Set<string>(['KIOSK_CHECKIN_REJECTED']);
const LOGIN_FAILURE_EVENTS = new Set<string>(['AUTH_LOGIN_FAILED', 'AUTH_LOGIN_INACTIVE_ACCOUNT']);
const KIOSK_REGISTER_FAILURE_EVENTS = new Set<string>(['KIOSK_REGISTER_REJECTED', 'KIOSK_IDENTIFY_REJECTED']);
const KIOSK_CHECKIN_FAILURE_EVENTS = new Set<string>(['KIOSK_CHECKIN_DENIED', 'KIOSK_CHECKIN_AMBIGUOUS']);
const SESSIONLESS_AUTH_PATHS = new Set<string>(['/auth/login', '/auth/refresh']);

/**
 * Detección de patrones sobre el flujo de eventos, con ventanas deslizantes
 * EN MEMORIA por clave (IP o cuenta).
 *
 * Limitación conocida: los contadores se reinician si el API se reinicia y
 * no se comparten entre varias instancias. Para varias instancias habría
 * que mover los contadores a un store compartido (ej. Redis) o a consultas
 * sobre audit.AuditEvent.
 */
export class AuditAnomalyDetector {
  private readonly rules: Rule[];
  private readonly hits = new Map<string, number[]>();
  private readonly suppressedUntil = new Map<string, number>();
  private readonly maxWindowMs: number;
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(config: AppConfig['audit']) {
    const burstMs = config.burstWindowSeconds * 1000;
    const repeatedMs = config.repeatedFailureWindowMinutes * 60 * 1000;
    const ip = (event: ObservedAuditEvent) => event.sourceIp ?? 'desconocida';

    this.rules = [
      // --- SEV1: ráfagas de una misma IP ---
      {
        alert: 'SECURITY_LOGIN_BURST',
        keyOf: (e) => (e.httpMethod === 'POST' && e.path === '/auth/login' ? ip(e) : null),
        threshold: config.burstThreshold,
        windowMs: burstMs,
      },
      {
        alert: 'SECURITY_KIOSK_BURST',
        keyOf: (e) =>
          e.httpMethod === 'POST' && e.path && KIOSK_ATTEMPT_PATH.test(e.path) && !KIOSK_LIVE_HINT_EVENTS.has(e.eventType)
            ? ip(e)
            : null,
        threshold: config.burstThreshold,
        windowMs: burstMs,
      },
      {
        alert: 'SECURITY_ROUTE_SCANNING',
        keyOf: (e) => (e.statusCode === 404 ? ip(e) : null),
        threshold: config.scanThreshold,
        windowMs: burstMs,
      },
      {
        alert: 'SECURITY_RATE_LIMIT_BURST',
        keyOf: (e) => (e.statusCode === 429 ? ip(e) : null),
        threshold: config.burstThreshold,
        windowMs: burstMs,
      },
      {
        alert: 'SECURITY_AUTH_FAILURE_BURST',
        keyOf: (e) =>
          (e.statusCode === 401 || e.statusCode === 403) &&
          e.eventType !== 'AUTH_TOKEN_EXPIRED' &&
          // Una IP ya bloqueada que insiste no genera alertas nuevas: ya se actuó sobre ella.
          e.eventType !== 'SECURITY_BLOCKED_IP_REQUEST' &&
          !(e.path && SESSIONLESS_AUTH_PATHS.has(e.path))
            ? ip(e)
            : null,
        threshold: config.burstThreshold,
        windowMs: burstMs,
      },
      // --- SEV2: fallos repetidos ---
      {
        alert: 'SECURITY_ACCOUNT_REPEATED_LOGIN_FAILURE',
        keyOf: (e) => (LOGIN_FAILURE_EVENTS.has(e.eventType) && e.actorUsername ? e.actorUsername.toLowerCase() : null),
        threshold: config.repeatedFailureThreshold,
        windowMs: repeatedMs,
      },
      {
        alert: 'SECURITY_KIOSK_REGISTER_REPEATED_FAILURE',
        keyOf: (e) => (KIOSK_REGISTER_FAILURE_EVENTS.has(e.eventType) ? ip(e) : null),
        threshold: config.repeatedFailureThreshold,
        windowMs: repeatedMs,
      },
      {
        alert: 'SECURITY_KIOSK_CHECKIN_REPEATED_FAILURE',
        keyOf: (e) => (KIOSK_CHECKIN_FAILURE_EVENTS.has(e.eventType) ? ip(e) : null),
        threshold: config.repeatedFailureThreshold,
        windowMs: repeatedMs,
      },
    ];

    this.maxWindowMs = Math.max(burstMs, repeatedMs);
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    this.cleanupTimer.unref();
  }

  /** Registra el evento en cada regla que aplique y devuelve las alertas que se dispararon. */
  observe(event: ObservedAuditEvent, now = Date.now()): AnomalyAlert[] {
    const alerts: AnomalyAlert[] = [];

    for (const rule of this.rules) {
      const subject = rule.keyOf(event);
      if (subject === null) continue;

      const key = `${rule.alert}|${subject}`;
      const recent = (this.hits.get(key) ?? []).filter((timestamp) => now - timestamp < rule.windowMs);
      recent.push(now);
      this.hits.set(key, recent);

      if (recent.length < rule.threshold || (this.suppressedUntil.get(key) ?? 0) > now) continue;

      // Una alerta por ventana: se reinicia el conteo y se silencia la clave
      // hasta que pase la ventana (si el patrón sigue, vuelve a disparar).
      this.hits.set(key, []);
      this.suppressedUntil.set(key, now + rule.windowMs);
      const isAccountRule = rule.alert === 'SECURITY_ACCOUNT_REPEATED_LOGIN_FAILURE';
      alerts.push({
        eventType: rule.alert,
        sourceIp: isAccountRule ? event.sourceIp : subject,
        actorUsername: isAccountRule ? event.actorUsername : null,
        correlationId: event.correlationId,
        details: {
          count: recent.length,
          threshold: rule.threshold,
          windowSeconds: Math.round(rule.windowMs / 1000),
          lastEventType: event.eventType,
          lastPath: event.path,
          lastStatusCode: event.statusCode,
        },
      });
    }

    return alerts;
  }

  dispose(): void {
    clearInterval(this.cleanupTimer);
  }

  private cleanup(now = Date.now()): void {
    for (const [key, timestamps] of this.hits) {
      if (timestamps.length === 0 || now - timestamps[timestamps.length - 1] > this.maxWindowMs) this.hits.delete(key);
    }
    for (const [key, until] of this.suppressedUntil) {
      if (until <= now) this.suppressedUntil.delete(key);
    }
  }
}
