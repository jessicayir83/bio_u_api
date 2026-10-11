import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  currentPassword: string;

  // bcrypt ignora todo lo que pase de 72 bytes: se rechaza en vez de truncar en silencio.
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword: string;
}
