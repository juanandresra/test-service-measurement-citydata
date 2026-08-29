import { CacheModuleAsyncOptions } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EnvConfig } from '../env/env.schema';
import { Keyv } from 'keyv';
import KeyvRedis from '@keyv/redis';

export const cacheConfig: CacheModuleAsyncOptions = {
  isGlobal: true,
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (configService: ConfigService<EnvConfig>) => ({
    stores: [
      new Keyv({
        store: new KeyvRedis(configService.getOrThrow<string>('VALKEY_URL')),
      }),
    ],
    ttl: configService.getOrThrow<number>('CACHE_TTL'),
  }),
};
