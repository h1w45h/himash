import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: () =>
        new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
          maxRetriesPerRequest: null, // нужно для блокирующих команд и адаптера Socket.io
          lazyConnect: false,
        }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule {}
