import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './common/prisma.module';
import { RedisModule } from './common/redis.module';
import { EventsModule } from './common/events.module';
import { MatchmakingModule } from './modules/matchmaking/matchmaking.module';
import { RoomsModule } from './modules/rooms/rooms.module';
import { MatchesModule } from './modules/matches/matches.module';
import { AuthModule } from './modules/auth/auth.module';
import { GamesModule } from './modules/games/games.module';
import { UsersModule } from './modules/users/users.module';
import { HealthController } from './modules/health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Общий лимит: 120 запросов в минуту на клиента; чувствительные эндпоинты ужесточаются декоратором.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    RedisModule,
    EventsModule,
    AuthModule,
    UsersModule,
    GamesModule,
    MatchesModule,
    RoomsModule,
    MatchmakingModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
