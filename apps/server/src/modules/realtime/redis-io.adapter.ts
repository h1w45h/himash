import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { ServerOptions } from 'socket.io';

/**
 * Socket.io поверх Redis pub/sub: событие, отправленное на любом инстансе сервера,
 * доходит до клиентов, подключённых к другим инстансам.
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(app: INestApplicationContext, private readonly redisUrl: string) {
    super(app);
  }

  connectToRedis() {
    const pub = new Redis(this.redisUrl);
    const sub = pub.duplicate();
    this.adapterConstructor = createAdapter(pub, sub);
  }

  override createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, { ...options, cors: { origin: true } }) as import('socket.io').Server;
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}
