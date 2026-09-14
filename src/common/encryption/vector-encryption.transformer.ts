import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import type { ValueTransformer } from 'typeorm';
import { getEncryptionKeyBuffer } from '../../config/configuration';

/**
 * Cifra/descifra transparentemente la columna Vector de biometric.Template
 * (Fase 7 — ver plan_implementation). AES-256-GCM vía el módulo `crypto`
 * nativo (sin dependencias nuevas). Formato guardado en la columna:
 * `iv:authTag:ciphertext` (hex). GCM da autenticidad además de
 * confidencialidad: si el dato fue alterado, `decipher.final()` lanza.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;

export const encryptedVectorTransformer: ValueTransformer = {
  to(value?: string | null): string | undefined {
    if (value === undefined || value === null) {
      return value as unknown as undefined;
    }
    const key = getEncryptionKeyBuffer();
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':');
  },

  from(value?: string | null): string | undefined {
    if (value === undefined || value === null) {
      return value as unknown as undefined;
    }
    const [ivHex, authTagHex, dataHex] = value.split(':');
    if (!ivHex || !authTagHex || !dataHex) {
      throw new Error('Formato de biometric.Template.Vector inválido (se esperaba iv:authTag:ciphertext).');
    }
    const key = getEncryptionKeyBuffer();
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
    return decrypted.toString('utf8');
  },
};
