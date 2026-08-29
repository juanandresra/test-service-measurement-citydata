import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'pino-nestjs';

@Injectable()
export class HealthService {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(HealthService.name);
  }

  check() {
    this.logger.info('Health check requested', HealthService.name);
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
