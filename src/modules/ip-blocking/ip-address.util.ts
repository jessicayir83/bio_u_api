import { isIP } from 'net';

/** "::ffff:192.168.1.40" (IPv4 mapeada en IPv6, como la reporta Node) → "192.168.1.40". */
export function normalizeIp(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.toLowerCase().startsWith('::ffff:') && isIP(trimmed.slice(7)) === 4 ? trimmed.slice(7) : trimmed;
}

export function isValidIp(value: string): boolean {
  return isIP(value) !== 0;
}

/** Bloquear la IP local dejaría sin acceso al propio servidor (y a quien administra desde esa PC). */
export function isLoopbackIp(value: string): boolean {
  return value === '::1' || value.startsWith('127.');
}
