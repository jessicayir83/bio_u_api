import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  // bcrypt ignora todo lo que pase de 72 bytes: se rechaza en vez de truncar en silencio.
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword: string;
}
