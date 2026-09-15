import { IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { IDENTIFICATION_TYPES } from '../../persons/identification';

/**
 * Datos que la persona llena en el kiosco al registrarse. Las fotos van
 * aparte, como archivos del multipart (campo `images`).
 */
export class KioskRegisterDto {
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
}
