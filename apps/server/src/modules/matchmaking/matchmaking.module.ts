import { Module } from '@nestjs/common';
import { RoomsModule } from '../rooms/rooms.module';
import { MatchmakingController } from './matchmaking.controller';
import { MatchmakingService } from './matchmaking.service';

@Module({ imports: [RoomsModule], controllers: [MatchmakingController], providers: [MatchmakingService] })
export class MatchmakingModule {}
