import { IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { IDENTIFICATION_TYPES } from '../../persons/identification';
import { ConsentFields } from '../../persons/dto/consent-fields';

/**
 * Datos que la persona llena en el kiosco al registrarse. Las fotos van
 * aparte, como archivos del multipart (campo `images`).
 */
export class KioskRegisterDto extends ConsentFields {
  @IsIn(IDENTIFICATION_TYPES, { message: 'Seleccioná un tipo de identificación válido.' })
  identificationType: string;

  /** Número de identificación del tipo elegido (se normaliza y valida en el servicio). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  nationalId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  firstName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  lastName: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  /**
   * Pasos de pose del registro guiado, en el mismo orden que las fotos del
   * campo `images` (ej. "FRONT,RIGHT,LEFT"). Opcional: sin él, el registro se
   * comporta como antes del Nivel 2. Los ids se validan en el controlador
   * contra el catálogo de `face-quality.ts`.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  steps?: string;
}
