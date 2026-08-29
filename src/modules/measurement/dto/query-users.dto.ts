import { IsDateString, IsOptional } from 'class-validator';

export class QueryUsersDto {
  @IsDateString()
  @IsOptional()
  dateFrom?: string;

  @IsDateString()
  @IsOptional()
  dateTo?: string;
}
