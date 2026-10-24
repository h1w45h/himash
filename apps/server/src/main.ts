import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './modules/realtime/redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: true,
    rawBody: true, // нужен для проверки подписи вебхуков Clerk
  });
  // Socket.io через Redis — события доходят до клиентов на всех инстансах.
  const adapter = new RedisIoAdapter(app, process.env.REDIS_URL ?? 'redis://localhost:6379');
  adapter.connectToRedis();
  app.useWebSocketAdapter(adapter);
  app.enableShutdownHooks(); // корректно закрываем Prisma/Redis при деплое
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
