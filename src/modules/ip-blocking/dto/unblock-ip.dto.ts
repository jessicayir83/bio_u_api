import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UnblockIpDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
