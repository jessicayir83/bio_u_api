import { IsInt, IsNotEmpty, IsString } from 'class-validator';

export class CreateEnrollmentDto {
  @IsInt()
  personId: number;

  @IsString()
  @IsNotEmpty()
  modality: string;
}
