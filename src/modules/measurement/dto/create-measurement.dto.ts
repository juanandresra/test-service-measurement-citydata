// src/modules/measurement/dto/create-measurement.dto.ts

import {
  IsNotEmpty,
  IsObject,
  IsString,
  IsArray,
  ArrayMinSize,
} from 'class-validator';

export class CreateMeasurementDto {
  @IsString()
  @IsNotEmpty()
  formVersion!: string;

  @IsObject()
  @IsNotEmpty()
  header!: object;

  /// Array de registros del body, cada uno con answers + meta (gps, timestamps, location)
  @IsArray()
  @ArrayMinSize(1)
  body!: Array<{
    id: string;
    answers: object;
    meta: {
      gpsTimestamp: string | null;
      deviceTimestamp: string;
      serverTimestamp: string | null;
      location: {
        latitude: number;
        longitude: number;
        accuracy: number | null;
        address?: string | null;
      } | null;
    };
    createdAt: string;
  }>;

  @IsObject()
  @IsNotEmpty()
  meta!: {
    track: Array<[number, number, number]>;
  };
}
