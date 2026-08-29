import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';
import { PinoLogger } from 'pino-nestjs';

@Controller('health')
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(HealthController.name);
  }

  @Get()
  check() {
    this.logger.info('Health check endpoint called', HealthController.name);
    return this.healthService.check();
  }
}
