import { IsNotEmpty, IsString } from 'class-validator';

export class CreatePersonIdentifierDto {
  @IsString()
  @IsNotEmpty()
  identifierType: string;

  @IsString()
  @IsNotEmpty()
  identifierValue: string;
}
