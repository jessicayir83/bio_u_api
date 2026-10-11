import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// Los topes evitan que un body gigante llegue a bcrypt (costo de CPU) o a la consulta de usuario.
export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  username: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;
}
