import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PinoLogger } from 'pino-nestjs';
import { DateTime } from 'luxon';
import { MeasurementPrismaService } from '../../common/modules/prisma/services/measurement.prisma.service';

@Injectable()
export class PartitionMaintenanceService implements OnModuleInit {
  constructor(
    private readonly prisma: MeasurementPrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PartitionMaintenanceService.name);
  }

  /**
   * Al iniciar el microservicio, verifica y asegura de inmediato que existan las
   * particiones del mes en curso y de los 3 meses futuros.
   */
  async onModuleInit(): Promise<void> {
    this.logger.info('Inicializando verificación de particiones al arranque...');
    try {
      await this.ensureUpcomingPartitions(3);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error inicializando particiones al arranque: ${msg}`);
    }
  }

  /**
   * Cron Job programado todos los domingos en la madrugada a las 2:00, 3:00 y 4:00 AM.
   * La repetición escalonada asegura reintentos automáticos si la BD estuvo ocupada.
   * La operación es totalmente idempotente (CREATE TABLE IF NOT EXISTS).
   */
  @Cron('0 2,3,4 * * 0')
  async handleSundayCronMaintenance(): Promise<void> {
    this.logger.info(
      'Ejecutando mantenimiento programado de particiones (Domingo 2:00, 3:00 o 4:00 AM)...',
    );
    await this.ensureUpcomingPartitions(3);
  }

  /**
   * Asegura que existan las particiones para el mes actual y los N meses siguientes.
   * Por ejemplo, si estamos en septiembre 2026 y monthsAhead = 3:
   *  - 2026_09 (mes actual)
   *  - 2026_10 (mes +1)
   *  - 2026_11 (mes +2)
   *  - 2026_12 (mes +3)
   */
  async ensureUpcomingPartitions(monthsAhead = 3): Promise<string[]> {
    const createdPartitions: string[] = [];
    const baseDate = DateTime.now().toUTC().startOf('month');

    for (let i = 0; i <= monthsAhead; i++) {
      const targetMonth = baseDate.plus({ months: i });
      const nextMonth = targetMonth.plus({ months: 1 });

      const partitionName = `measurement_item_${targetMonth.toFormat('yyyy_MM')}`;
      const startDate = targetMonth.toFormat('yyyy-MM-dd 00:00:00');
      const endDate = nextMonth.toFormat('yyyy-MM-dd 00:00:00');

      try {
        const query = `
          CREATE TABLE IF NOT EXISTS "${partitionName}"
          PARTITION OF "measurement_item"
          FOR VALUES FROM ('${startDate}') TO ('${endDate}');
        `;

        await this.prisma.$executeRawUnsafe(query);

        this.logger.info(
          {
            partitionName,
            range: [startDate, endDate],
          },
          `Partición verificada/creada exitosamente: ${partitionName}`,
        );

        createdPartitions.push(partitionName);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.logger.error(
          {
            partitionName,
            startDate,
            endDate,
            err: errorMsg,
          },
          `Error asegurando la partición ${partitionName}`,
        );
        throw error;
      }
    }

    return createdPartitions;
  }
}
