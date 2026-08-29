import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class QueryMeasurementDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 20;

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

  @IsDateString()
  @IsOptional()
  dateFrom?: string;

  @IsDateString()
  @IsOptional()
  dateTo?: string;

  /**
   * Zona horaria IANA (ej. "America/Bogota") usada por exportExcel para
   * formatear "Fecha Captura" y el timestamp del nombre de archivo. No
   * afecta a findAll/exportExcel para el filtrado, solo el formateo de
   * salida. Mismo regex de GetSummaryQueryDto para prevenir inyección SQL
   * si en algún momento se interpola en un raw query.
   */
  @Matches(/^[A-Za-z0-9/_+-]+$/)
  @IsOptional()
  timezone?: string = 'America/Santiago';
}
