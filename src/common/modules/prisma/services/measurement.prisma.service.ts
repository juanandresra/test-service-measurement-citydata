import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'pino-nestjs';

import { PrismaClient } from '@prisma/measurement/generated/client';

import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class MeasurementPrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(
    configService: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    const connectionString = configService.getOrThrow<string>('DATABASE_URL');

    const pool = new Pool({
      connectionString,
    });

    const adapter = new PrismaPg(pool);

    super({
      adapter,
      log: ['info', 'warn', 'error'],
    });

    this.logger.setContext(MeasurementPrismaService.name);
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();

      await this.$queryRaw`SELECT 1`;

      this.logger.info('Prisma connected to PostgreSQL');
    } catch (error) {
      this.logger.error(error, 'Prisma connection error');

      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();

    this.logger.info('Prisma disconnected from PostgreSQL');
  }
}
