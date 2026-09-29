import { IsBoolean, IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { IDENTIFICATION_TYPES } from '../identification';
import { ConsentFields } from './consent-fields';

export class CreatePersonDto extends ConsentFields {
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
   * El operador ya vio el aviso de "ese número existe con otro tipo" y
   * confirmó que quiere registrarla igual. Solo sirve para ese caso: nunca
   * permite duplicar el mismo tipo + número, que sigue siendo un 409 duro.
   */
  @IsOptional()
  @IsBoolean()
  allowDuplicateNumber?: boolean;
}
