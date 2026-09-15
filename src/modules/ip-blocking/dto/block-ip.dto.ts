import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Duraciones ofrecidas en el dashboard: 1 h, 24 h, 7 días, 30 días. Sin duración = permanente. */
export const BLOCK_DURATION_HOURS = [1, 24, 168, 720] as const;

export class BlockIpDto {
  /** La alerta de auditoría desde la que se bloquea: la IP se toma de ahí, no la escribe el usuario. */
  @IsString()
  @Matches(/^\d{1,19}$/)
  sourceAuditEventId: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;

  @IsOptional()
  @IsIn(BLOCK_DURATION_HOURS)
  durationHours?: number;
}
