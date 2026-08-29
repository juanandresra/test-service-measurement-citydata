import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModuleAsyncParams } from 'pino-nestjs';
import { prettyTransport } from './transports/pretty.transport';
import { lokiTransport } from './transports/loki.transport';
import { plainTextTransport } from './transports/plain-text.transport';
import { EnvConfig } from '../env/env.schema';

export const loggerConfig: LoggerModuleAsyncParams = {
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (configService: ConfigService<EnvConfig>) => {
    const isDev = configService.getOrThrow<string>('NODE_ENV') !== 'production';
    return {
      pinoHttp: {
        level: isDev ? 'trace' : 'info',
        // Desactiva logging automático de peticiones HTTP por ejemplo request completed, request error, etc.
        autoLogging: true,
        transport: {
          targets: [
            ...(isDev ? [prettyTransport] : [plainTextTransport]),
            lokiTransport(configService),
          ],
        },
        /**
         * Elimina metadata base de Pino.
         *
         * Evita:
         * - hostname
         * - pid
         * - name
         */
        formatters: {
          bindings: () => ({}),
        },

        /**
         * Propiedades agregadas
         * automáticamente a todos los logs.
         */
        customProps: () => ({
          environment: configService.getOrThrow<string>('NODE_ENV'),
        }),

        /**
         * Oculta información sensible
         * automáticamente en logs.
         *
         * IMPORTANTE:
         * Evita filtrar:
         * - JWTs
         * - cookies
         * - passwords
         * - tokens
         */
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'password',
            'token',
          ],

          /**
           * Valor mostrado
           * en lugar del real.
           */
          censor: '***',
        },
      },
    };
  },
};
