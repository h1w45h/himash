import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './common/prisma.module';
import { RedisModule } from './common/redis.module';
import { EventsModule } from './common/events.module';
import { MatchmakingModule } from './modules/matchmaking/matchmaking.module';
import { RoomsModule } from './modules/rooms/rooms.module';
import { MatchesModule } from './modules/matches/matches.module';
import { ChatModule } from './modules/chat/chat.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { PresenceModule } from './common/presence.module';
import { FriendsModule } from './modules/friends/friends.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AchievementsModule } from './modules/achievements/achievements.module';
import { ShopModule } from './modules/shop/shop.module';
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
    PresenceModule,
    NotificationsModule,
    AchievementsModule,
    ShopModule,
    AuthModule,
    UsersModule,
    GamesModule,
    MatchesModule,
    RoomsModule,
    MatchmakingModule,
    ChatModule,
    FriendsModule,
    RealtimeModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
