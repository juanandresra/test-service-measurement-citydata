import { ConfigService } from '@nestjs/config';

export const lokiTransport = (configService: ConfigService) => ({
  target: 'pino-loki',
  options: {
    host: configService.getOrThrow<string>('LOKI_URL'),
    labels: {
      app: configService.getOrThrow<string>('APP_NAME'),
      env: configService.getOrThrow<string>('NODE_ENV'),
    },
    replaceTimestamp: true,
    silenceErrors: false,
  },
});
