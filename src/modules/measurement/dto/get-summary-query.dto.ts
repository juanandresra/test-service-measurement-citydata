// src/modules/measurement/dto/get-summary-query.dto.ts

import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsDateString,
  IsUUID,
  Matches,
} from 'class-validator';

export enum SummaryGrouping {
  USER = 'user',
  MONTH = 'month',
  DAY = 'day',
  HOUR = 'hour',
}

export class GetSummaryQueryDto {
  @IsEnum(SummaryGrouping)
  groupBy!: SummaryGrouping;

  /// Filtra por los measurers que capturaron la medición.
  /// Acepta uno o varios (?userId=a&userId=b) o ninguno (todos).
  @Transform(({ value }: { value: unknown }): string[] | undefined => {
    if (value === undefined) return undefined;
    if (Array.isArray(value)) return value as string[];
    return [value as string];
  })
  @IsUUID('4', { each: true })
  @IsOptional()
  userId?: string[];

  // Alineado con las variables temporales de tu query de locations
  @IsDateString()
  @IsOptional()
  dateFrom?: string;

  @IsDateString()
  @IsOptional()
  dateTo?: string;

  /**
   * Zona horaria IANA (ej. "America/Bogota") usada para truncar
   * month/day/hour. Sin esto, date_trunc trabaja en UTC y el agrupamiento
   * queda desfasado respecto a lo que el usuario ve en la tabla, que sí
   * está convertido a su hora local en el cliente.
   * Regex simple para prevenir inyección SQL (se interpola directo en
   * $queryRawUnsafe, igual que el resto de filtros de este endpoint):
   * solo letras, dígitos, '/', '_', '+', '-'.
   */
  @Matches(/^[A-Za-z0-9/_+-]+$/)
  @IsOptional()
  timezone?: string = 'UTC';
}
