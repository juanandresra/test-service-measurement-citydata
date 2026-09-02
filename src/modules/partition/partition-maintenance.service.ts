import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PinoLogger } from 'pino-nestjs';
import { DateTime } from 'luxon';
import { CronJob } from 'cron';
import { MeasurementPrismaService } from '../../common/modules/prisma/services/measurement.prisma.service';

@Injectable()
export class PartitionMaintenanceService implements OnModuleInit {
  constructor(
    private readonly prisma: MeasurementPrismaService,
    private readonly logger: PinoLogger,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {
    this.logger.setContext(PartitionMaintenanceService.name);
  }

  /**
   * Gancho de ciclo de vida de NestJS. Se ejecuta automáticamente al inicializar el módulo.
   * Lee la zona horaria (TZ) desde el entorno (ej: America/Bogota) y programa el CronJob.
   */
  async onModuleInit(): Promise<void> {
    const tz = this.configService.get<string>('TZ') ?? 'UTC';

    const localServerTime = DateTime.now().toString();
    const targetZoneTime = DateTime.now().setZone(tz).toString();

    this.logger.info(
      {
        configuredTimeZone: tz,
        serverLocalTime: localServerTime,
        targetZoneTime,
      },
      'PartitionMaintenanceService inicializado exitosamente. Sincronización de zona horaria verificada.',
    );

    // 1. Verificación y pre-asignación inmediata de particiones al arranque
    try {
      await this.ensureUpcomingPartitions(3);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error inicializando particiones al arranque: ${msg}`);
    }

    // 2. Registro dinámico de CronJob respetando la zona horaria (TZ) del entorno
    const cronExpression = '0 2,3,4 * * 0'; // Ejecuta a las 02:00, 03:00 y 04:00 horas todos los domingos en la zona horaria configurada

    const job = new CronJob(
      cronExpression,
      () => {
        void this.handleSundayCronMaintenance();
      },
      null,
      false,
      tz,
    );

    this.schedulerRegistry.addCronJob(
      'measurement-partition-scheduled-maintenance',
      job,
    );

    job.start();

    this.logger.info(
      {
        cronJobName: 'measurement-partition-scheduled-maintenance',
        cronSchedule: cronExpression,
        configuredTimeZone: tz,
        nextExecution: job.nextDate().toISO(),
      },
      'Cron Job de mantenimiento de particiones registrado e iniciado en SchedulerRegistry.',
    );
  }

  /**
   * Ejecución periódica dominical escalonada a las 2:00, 3:00 y 4:00 AM (Zona horaria configurada).
   */
  async handleSundayCronMaintenance(): Promise<void> {
    const tz = this.configService.get<string>('TZ') ?? 'UTC';
    this.logger.info(
      {
        currentZoneTime: DateTime.now().setZone(tz).toISO(),
        configuredTimeZone: tz,
      },
      'Ejecutando mantenimiento programado de particiones (Domingo en zona horaria configurada)...',
    );
    await this.ensureUpcomingPartitions(3);
  }

  /**
   * Asegura que existan las particiones para el mes actual y los N meses siguientes
   * basándose en la zona horaria configurada.
   */
  async ensureUpcomingPartitions(monthsAhead = 3): Promise<string[]> {
    const tz = this.configService.get<string>('TZ') ?? 'UTC';
    const createdPartitions: string[] = [];
    const baseDate = DateTime.now().setZone(tz).startOf('month');

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
            timeZone: tz,
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
            timeZone: tz,
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
