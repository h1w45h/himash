import { Body, Controller, Get, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/auth.decorators';
import type { AuthUser } from '../auth/auth.types';
import { parse } from '../users/users.controller';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly n: NotificationsService) {}

  @Get()
  async list(@CurrentUser() u: AuthUser) {
    const [items, unread] = await Promise.all([this.n.list(u.id), this.n.unreadCount(u.id)]);
    return { items, unread };
  }

  @Post('read')
  read(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    const { ids } = parse(z.object({ ids: z.array(z.string()).max(100).optional() }), body ?? {});
    return this.n.markRead(u.id, ids);
  }
}
