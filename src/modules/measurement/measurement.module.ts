import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/modules/prisma/prisma.module';
import { MeasurementController } from './measurement.controller';
import { MeasurementOrganizationController } from './measurement-organization.controller';
import { MeasurementService } from './measurement.service';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    PrismaModule,
    ClientsModule.registerAsync([
      {
        name: 'VALKEY_SERVICE',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => {
          const valkeyUrl = configService.getOrThrow<string>('VALKEY_URL');
          const { hostname, port, username, password, pathname } = new URL(
            valkeyUrl,
          );

          return {
            transport: Transport.REDIS,
            options: {
              host: hostname,
              port: Number(port || 6379),
              username: username || undefined,
              password: password || undefined,
              db:
                pathname && pathname !== '/'
                  ? Number(pathname.slice(1))
                  : undefined,
            },
          };
        },
      },
    ]),
  ],
  controllers: [MeasurementController, MeasurementOrganizationController],
  providers: [MeasurementService],
})
export class MeasurementModule {}
