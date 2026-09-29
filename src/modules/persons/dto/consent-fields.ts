import { Transform } from 'class-transformer';
import { Equals, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Consentimiento informado, obligatorio para registrar a una persona (kiosco
 * y panel). Campos planos a propósito: el kiosco manda multipart, donde todo
 * llega como texto ("true").
 */
export abstract class ConsentFields {
  @Transform(({ value }) => value === true || value === 'true')
  @Equals(true, { message: 'Se requiere el consentimiento informado para tratar datos biométricos.' })
  consentAccepted: boolean;

  /** Versión de los textos legales que vio la persona (la define el frontend). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  policyVersion: string;
}
