import { Module } from '@nestjs/common';
import { MatchesModule } from '../matches/matches.module';
import { InvitationsService } from './invitations.service';
import { InvitationsController, RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';

@Module({
  imports: [MatchesModule],
  controllers: [RoomsController, InvitationsController],
  providers: [RoomsService, InvitationsService],
  exports: [RoomsService],
})
export class RoomsModule {}
