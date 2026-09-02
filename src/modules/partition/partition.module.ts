import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/modules/prisma/prisma.module';
import { PartitionMaintenanceService } from './partition-maintenance.service';

@Module({
  imports: [PrismaModule],
  providers: [PartitionMaintenanceService],
  exports: [PartitionMaintenanceService],
})
export class PartitionModule {}
