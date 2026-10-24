import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/auth.decorators';
import type { AuthUser } from '../auth/auth.types';
import { parse } from '../users/users.controller';
import { FriendsService } from './friends.service';

@Controller('friends')
export class FriendsController {
  constructor(private readonly friends: FriendsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.friends.list(u.id);
  }

  @Post('requests')
  request(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    const dto = parse(z.object({ userId: z.string().optional(), username: z.string().max(24).optional() }).refine((d) => d.userId || d.username, 'Укажите игрока'), body);
    return this.friends.request(u.id, dto);
  }

  @Post('requests/:id/accept')
  accept(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.friends.accept(u.id, id);
  }

  @Post('requests/:id/decline')
  decline(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.friends.decline(u.id, id);
  }

  @Get('blocks')
  blocks(@CurrentUser() u: AuthUser) {
    return this.friends.blocks(u.id);
  }

  @Post('blocks/:userId')
  block(@CurrentUser() u: AuthUser, @Param('userId') userId: string) {
    return this.friends.block(u.id, userId);
  }

  @Delete('blocks/:userId')
  unblock(@CurrentUser() u: AuthUser, @Param('userId') userId: string) {
    return this.friends.unblock(u.id, userId);
  }

  @Delete(':userId')
  remove(@CurrentUser() u: AuthUser, @Param('userId') userId: string) {
    return this.friends.remove(u.id, userId);
  }
}
