import { ForbiddenException, Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { RealtimeError } from '@nastolki/shared';
import { CurrentUser } from '../auth/auth.decorators';
import type { AuthUser } from '../auth/auth.types';
import { ChatService } from './chat.service';

@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('rooms/:code')
  room(@CurrentUser() u: AuthUser, @Param('code') code: string) {
    return this.wrap(() => this.chat.history(u.id, 'ROOM', code));
  }

  @Get('matches/:id')
  match(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.wrap(() => this.chat.history(u.id, 'MATCH', id));
  }

  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof RealtimeError) {
        throw e.code === 'NOT_FOUND' ? new NotFoundException(e.message) : new ForbiddenException(e.message);
      }
      throw e;
    }
  }
}
