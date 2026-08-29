import { Module } from '@nestjs/common';

import { ConfigModule } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';

import { AppService } from './app.service';
import { LoggerModule } from 'pino-nestjs';
import { loggerConfig } from './common/config/logger/logger.config';
import { envSchema } from './common/config/env/env.schema';
import { cacheConfig } from './common/config/cache/cache.config';
import { HealthModule } from './modules/health/health.module';
import { MeasurementModule } from './modules/measurement/measurement.module';

@Module({
  imports: [
    // Modulos de configuración
    // Carga variables de entorno y valida con zod
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config) => envSchema.parse(config),
    }),
    LoggerModule.forRootAsync(loggerConfig),
    CacheModule.registerAsync(cacheConfig),
    // Modulos API
    HealthModule,
    MeasurementModule,
  ],
  providers: [AppService],
})
export class AppModule {}
