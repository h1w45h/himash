import { Body, Controller, Get, Module, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/auth.decorators';
import type { AuthUser } from '../auth/auth.types';
import { RoomsModule } from '../rooms/rooms.module';
import { parse } from '../users/users.controller';
import { TournamentsService } from './tournaments.service';

const createSchema = z.object({
  gameSlug: z.string(),
  title: z.string().trim().min(3, 'Название: минимум 3 символа').max(60),
  description: z.string().trim().max(300).optional(),
  maxPlayers: z.union([z.literal(4), z.literal(8), z.literal(16), z.literal(32)]),
  entryFee: z.number().int().min(0).max(10_000).default(0),
  isPrivate: z.boolean().default(false),
  startsAt: z.coerce.date(),
});

@Controller('tournaments')
class TournamentsController {
  constructor(private readonly t: TournamentsService) {}

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    return this.t.create(u.id, parse(createSchema, body));
  }

  @Get()
  list(@CurrentUser() u: AuthUser, @Query('scope') scope?: string) {
    return this.t.list(u.id, scope === 'mine' || scope === 'finished' ? scope : 'open');
  }

  @Get('code/:code')
  byCode(@Param('code') code: string) {
    return this.t.byCode(code);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.t.get(u.id, id);
  }

  @Post(':id/join')
  join(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.t.join(u.id, id, parse(z.object({ code: z.string().max(12).optional() }), body ?? {}).code);
  }

  @Post(':id/leave')
  leave(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.t.leave(u.id, id);
  }

  @Post(':id/start')
  start(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.t.start(u.id, id);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.t.cancel(u.id, id);
  }
}

@Module({ imports: [RoomsModule], controllers: [TournamentsController], providers: [TournamentsService], exports: [TournamentsService] })
export class TournamentsModule {}
