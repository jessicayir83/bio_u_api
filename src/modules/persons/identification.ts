/**
 * Tipos de identificación de una persona y reglas de formato.
 *
 * Formatos asumidos de Costa Rica (el tipo DIMEX es el documento de
 * residentes extranjeros de CR):
 * - CEDULA: cédula de identidad física, 9 dígitos (ej. 1-2345-6789).
 * - DIMEX: 11 o 12 dígitos.
 * - PASAPORTE: 5 a 20 letras/números.
 * - OTRO: 3 a 50 caracteres.
 *
 * El número se guarda NORMALIZADO para que el mismo documento escrito
 * distinto ("1-2345-6789" vs "123456789") no pase como otra persona.
 */

export const IDENTIFICATION_TYPES = ['CEDULA', 'DIMEX', 'PASAPORTE', 'OTRO'] as const;
export type IdentificationType = (typeof IDENTIFICATION_TYPES)[number];

export const IDENTIFICATION_TYPE_LABELS: Record<IdentificationType, string> = {
  CEDULA: 'Cédula de Identidad',
  DIMEX: 'DIMEX (Extranjeros)',
  PASAPORTE: 'Pasaporte',
  OTRO: 'Otro',
};

export function normalizeIdentificationNumber(type: IdentificationType, value: string): string {
  const trimmed = value.trim();
  switch (type) {
    case 'CEDULA':
    case 'DIMEX':
      return trimmed.replace(/[\s-]/g, '');
    case 'PASAPORTE':
      return trimmed.replace(/[\s-]/g, '').toUpperCase();
    case 'OTRO':
      return trimmed.replace(/\s+/g, ' ').toUpperCase();
  }
}

/** Mensaje de error para la persona, o null si el número (ya normalizado) es válido para el tipo. */
export function findIdentificationProblem(type: IdentificationType, normalized: string): string | null {
  switch (type) {
    case 'CEDULA':
      return /^\d{9}$/.test(normalized) ? null : 'La cédula debe tener 9 dígitos (ej. 1-2345-6789).';
    case 'DIMEX':
      return /^\d{11,12}$/.test(normalized) ? null : 'El DIMEX debe tener 11 o 12 dígitos.';
    case 'PASAPORTE':
      return /^[A-Z0-9]{5,20}$/.test(normalized) ? null : 'El pasaporte debe tener entre 5 y 20 letras o números.';
    case 'OTRO':
      return normalized.length >= 3 && normalized.length <= 50 ? null : 'La identificación debe tener entre 3 y 50 caracteres.';
  }
}
