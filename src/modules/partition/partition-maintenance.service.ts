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
   * Crea dinámicamente las particiones del año vigente omitiendo los meses pasados + 2 meses del año siguiente,
   * y programa el CronJob dominical de mantenimiento.
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

    // 1. Verificación y pre-creación dinámica al levantar el microservicio:
    // Crea todos los meses restantes del año vigente (omitiendo los que ya pasaron) + 2 meses del siguiente año
    try {
      await this.ensureCurrentYearAndUpcomingPartitions();
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
    await this.ensureCurrentYearAndUpcomingPartitions();
  }

  /**
   * Asegura que existan las particiones para todos los meses restantes del año vigente
   * (omitiendo los meses que ya pasaron) más 2 meses de colchón del año siguiente.
   *
   * Ejemplos de comportamiento:
   *  - Si se ejecuta en Septiembre 2026 (mes 9):
   *    Crea 2026_09, 2026_10, 2026_11, 2026_12 (año actual)
   *    más 2027_01 y 2027_02 (2 meses del año siguiente). Total: 6 particiones.
   *  - Si se ejecuta un 31 de Diciembre (mes 12) por primera vez:
   *    Crea 2026_12 (mes actual)
   *    más 2027_01 y 2027_02 (2 meses del año siguiente). Total: 3 particiones.
   *  - Si se ejecuta en Enero (mes 1):
   *    Crea los 12 meses del año en curso
   *    más 2 meses del siguiente año (Enero y Febrero). Total: 14 particiones.
   */
  async ensureCurrentYearAndUpcomingPartitions(): Promise<string[]> {
    const tz = this.configService.get<string>('TZ') ?? 'UTC';
    const now = DateTime.now().setZone(tz);
    const createdPartitions: string[] = [];

    // Meses restantes del año vigente después del actual (ej: si mes = 9, faltan 10, 11, 12 = 3 meses)
    const remainingMonthsThisYear = 12 - now.month;
    // Sumamos 2 meses de colchón del año siguiente
    const totalMonthsAhead = remainingMonthsThisYear + 2;

    const baseDate = now.startOf('month');

    for (let i = 0; i <= totalMonthsAhead; i++) {
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
