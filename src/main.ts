import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from 'pino-nestjs';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { EnvConfig } from './common/config/env/env.schema';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap() {
  // Crea la aplicación NestJS con bufferLogs para asegurar que los logs se capturen antes de que el logger esté completamente configurado
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const configService = app.get(ConfigService<EnvConfig>);

  // Configura validación global, CORS, interceptores y filtros globales
  app.useGlobalPipes(
    // Configura ValidationPipe global con transformación, eliminación de propiedades no definidas y formato de errores personalizado
    new ValidationPipe({
      transform: true,
      whitelist: true,
      exceptionFactory: (validationErrors) => {
        const errors = validationErrors.flatMap((error) =>
          Object.entries(error.constraints ?? {}).map(
            ([constraint, message]) => ({
              code: `VALIDATION_ERROR_${constraint.toUpperCase()}`,
              field: error.property,
              message,
            }),
          ),
        );
        return new BadRequestException({ errors });
      },
    }),
  );
  // app.enableCors({
  //   origin: '*', // o '*' para permitir todos los orígenes
  //   methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  // });
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  // Configura Pino como logger global
  const logger = app.get(Logger);
  app.useLogger(logger);

  // Valkey / Redis microservice
  const valkeyUrl = configService.getOrThrow<string>('VALKEY_URL');
  const { hostname, port, username, password, pathname } = new URL(valkeyUrl);

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.REDIS,
    options: {
      host: hostname,
      port: Number(port || 6379),
      username: username || undefined,
      password: password || undefined,
      db: pathname && pathname !== '/' ? Number(pathname.slice(1)) : undefined,
      retryAttempts: 5,
      retryDelay: 3000,
      wildcards: true,
    },
  });

  // inicia microservices
  await app.startAllMicroservices();

  // inicia aplicación HTTP
  await app.listen(configService.getOrThrow<number>('PORT'));

  // Loguea la URL de la aplicación una vez que esté corriendo
  logger.log(`Application is running on: ${await app.getUrl()}`, 'Bootstrap');
  logger.log(
    `Application Name: ${configService.getOrThrow<string>('APP_NAME')}`,
    'Bootstrap',
  );
}

void bootstrap();
