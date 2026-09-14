import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Datos que la persona llena en el kiosco al registrarse. Las fotos van
 * aparte, como archivos del multipart (campo `images`).
 */
export class KioskRegisterDto {
  @IsString()
  @IsNotEmpty()
  nationalId: string;

  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;
}
