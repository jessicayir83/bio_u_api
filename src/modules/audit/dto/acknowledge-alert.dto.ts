import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AcknowledgeAlertDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
