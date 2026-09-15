import { Transform, Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { AUDIT_CATEGORIES, AUDIT_OUTCOMES, AUDIT_SEVERITIES } from '../audit.constants';

/** Filtros del listado/exportación. `severity` acepta "SEV1,SEV2" o el parámetro repetido. */
export class AuditEventsQueryDto {
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : String(value).split(',')).map((item: string) => item.trim()).filter(Boolean))
  @IsArray()
  @IsIn(AUDIT_SEVERITIES, { each: true })
  severity?: string[];

  @IsOptional()
  @IsIn(AUDIT_CATEGORIES)
  category?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9_]{1,80}$/)
  eventType?: string;

  @IsOptional()
  @IsIn(AUDIT_OUTCOMES)
  outcome?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sourceIp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  actor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  actorUserId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  targetType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  targetId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  correlationId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  acknowledged?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}
