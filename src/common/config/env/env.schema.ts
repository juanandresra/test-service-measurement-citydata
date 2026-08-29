import { z } from 'zod';

export const envSchema = z.object({
  APP_NAME: z.string().default('nestjs-app'),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().min(1).max(65535).default(3006),
  LOKI_URL: z.string().url().default('http://localhost:3100'),
  VALKEY_URL: z.string().url().default('redis://localhost:6379'),
  CACHE_TTL: z.coerce.number().min(0).default(10_000),
  DATABASE_URL: z.string().min(1),
  MEASUREMENT_DELETION_RETENTION_DAYS: z.coerce.number().min(0).default(30),
});

export type EnvConfig = z.infer<typeof envSchema>;
export type NodeEnv = EnvConfig['NODE_ENV'];
