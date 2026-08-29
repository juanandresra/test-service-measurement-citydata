// src/modules/measurement/dto/organization-summary-query.dto.ts

import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsDateString,
  IsUUID,
  Matches,
} from 'class-validator';
import { SummaryGrouping } from './get-summary-query.dto';

export class OrganizationSummaryQueryDto {
  @IsEnum(SummaryGrouping)
  groupBy!: SummaryGrouping;

  @Transform(({ value }: { value: unknown }): string[] | undefined => {
    if (value === undefined || value === null || value === '') return undefined;
    if (Array.isArray(value)) return value as string[];
    return [value as string];
  })
  @IsUUID('4', { each: true })
  @IsOptional()
  researchIds?: string[];

  @Transform(({ value }: { value: unknown }): string[] | undefined => {
    if (value === undefined || value === null || value === '') return undefined;
    if (Array.isArray(value)) return value as string[];
    return [value as string];
  })
  @IsUUID('4', { each: true })
  @IsOptional()
  campaignIds?: string[];

  @IsDateString()
  @IsOptional()
  dateFrom?: string;

  @IsDateString()
  @IsOptional()
  dateTo?: string;

  @Matches(/^[A-Za-z0-9/_+-]+$/)
  @IsOptional()
  timezone?: string = 'UTC';
}
