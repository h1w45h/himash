import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { FriendsModule } from '../friends/friends.module';
import { MatchesModule } from '../matches/matches.module';
import { RoomsModule } from '../rooms/rooms.module';
import { GameGateway } from './game.gateway';

@Module({ imports: [RoomsModule, MatchesModule, ChatModule, FriendsModule], providers: [GameGateway] })
export class RealtimeModule {}
