// src/modules/measurement/dto/query-locations.dto.ts

import { Transform } from 'class-transformer';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class QueryLocationsDto {
  /// Filtra por los measurers. Uno o varios (?userId=a&userId=b) o ninguno (todos).
  @Transform(({ value }: { value: unknown }): string[] | undefined => {
    if (value === undefined) return undefined;
    if (Array.isArray(value)) return value as string[];
    return [value as string];
  })
  @IsUUID('4', { each: true })
  @IsOptional()
  userId?: string[];

  @IsDateString()
  @IsOptional()
  dateFrom?: string;

  @IsDateString()
  @IsOptional()
  dateTo?: string;
}
