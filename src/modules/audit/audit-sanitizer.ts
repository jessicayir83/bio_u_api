/**
 * Saneado de `Details` antes de escribir: la auditoría nunca debe contener
 * secretos, material biométrico ni valores de datos personales.
 */

/** Claves cuyo valor se reemplaza por "[REDACTED]" (coincidencia parcial, sin distinguir mayúsculas). */
const REDACTED_KEY_PATTERN =
  /pass(word)?|token|secret|authorization|cookie|vector|descriptor|template|image|photo|buffer|nationalid|cedula|firstname|lastname|dateofbirth|identifiervalue/i;

const MAX_STRING_LENGTH = 500;
const MAX_DEPTH = 5;
const MAX_ARRAY_ITEMS = 50;
const MAX_DETAILS_JSON_LENGTH = 8000;

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return '[REDACTED]';
  if (depth >= MAX_DEPTH) return '[…]';

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) items.push(`… ${value.length - MAX_ARRAY_ITEMS} más`);
    return items;
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      result[key] = REDACTED_KEY_PATTERN.test(key) ? '[REDACTED]' : sanitizeValue(inner, depth + 1);
    }
    return result;
  }

  return String(value);
}

export function sanitizeDetails(details: Record<string, unknown> | undefined): string | null {
  if (!details || Object.keys(details).length === 0) return null;
  const json = JSON.stringify(sanitizeValue(details, 0));
  return json.length > MAX_DETAILS_JSON_LENGTH
    ? JSON.stringify({ truncated: true, preview: json.slice(0, MAX_DETAILS_JSON_LENGTH - 100) })
    : json;
}

export function truncate(value: string | null | undefined, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}
