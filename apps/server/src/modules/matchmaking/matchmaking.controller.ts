import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { matchmakingJoinSchema } from '@nastolki/shared';
import { CurrentUser } from '../auth/auth.decorators';
import type { AuthUser } from '../auth/auth.types';
import { parse } from '../users/users.controller';
import { MatchmakingService } from './matchmaking.service';

@Controller('matchmaking')
export class MatchmakingController {
  constructor(private readonly mm: MatchmakingService) {}

  @Post('join')
  join(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    return this.mm.join(u.id, parse(matchmakingJoinSchema, body));
  }

  @Delete()
  leave(@CurrentUser() u: AuthUser) {
    return this.mm.leave(u.id);
  }

  @Get('status')
  status(@CurrentUser() u: AuthUser) {
    return this.mm.status(u.id);
  }
}
