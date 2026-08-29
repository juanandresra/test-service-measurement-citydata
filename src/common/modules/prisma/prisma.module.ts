import { Module } from '@nestjs/common';
import { MeasurementPrismaService } from './services/measurement.prisma.service';

@Module({
  providers: [MeasurementPrismaService],
  exports: [MeasurementPrismaService],
})
export class PrismaModule {}
