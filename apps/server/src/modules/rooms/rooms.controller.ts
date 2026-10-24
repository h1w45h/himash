import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { addBotSchema, createRoomSchema, inviteSchema, joinRoomSchema, readySchema } from '@nastolki/shared';
import { CurrentUser } from '../auth/auth.decorators';
import type { AuthUser } from '../auth/auth.types';
import { parse } from '../users/users.controller';
import { InvitationsService } from './invitations.service';
import { RoomsService } from './rooms.service';

@Controller('rooms')
export class RoomsController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly invitations: InvitationsService,
  ) {}

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    return this.rooms.create(u.id, parse(createRoomSchema, body));
  }

  @Get()
  list(@Query('game') game?: string) {
    return this.rooms.listPublic(game);
  }

  // «mine» объявлен раньше ':code', иначе роутер примет его за код комнаты.
  @Get('mine')
  mine(@CurrentUser() u: AuthUser) {
    return this.rooms.mine(u.id);
  }

  @Get(':code')
  get(@Param('code') code: string) {
    return this.rooms.get(code);
  }

  @Post(':code/join')
  join(@CurrentUser() u: AuthUser, @Param('code') code: string, @Body() body: unknown) {
    return this.rooms.join(u.id, code, parse(joinRoomSchema, body ?? {}).password);
  }

  @Post(':code/leave')
  leave(@CurrentUser() u: AuthUser, @Param('code') code: string) {
    return this.rooms.leave(u.id, code);
  }

  @Post(':code/ready')
  ready(@CurrentUser() u: AuthUser, @Param('code') code: string, @Body() body: unknown) {
    return this.rooms.setReady(u.id, code, parse(readySchema, body).ready);
  }

  @Post(':code/bots')
  addBot(@CurrentUser() u: AuthUser, @Param('code') code: string, @Body() body: unknown) {
    return this.rooms.addBot(u.id, code, parse(addBotSchema, body ?? {}).level);
  }

  @Delete(':code/players/:seat')
  kick(@CurrentUser() u: AuthUser, @Param('code') code: string, @Param('seat', ParseIntPipe) seat: number) {
    return this.rooms.kick(u.id, code, seat);
  }

  @Post(':code/start')
  start(@CurrentUser() u: AuthUser, @Param('code') code: string) {
    return this.rooms.start(u.id, code);
  }

  @Post(':code/invite')
  invite(@CurrentUser() u: AuthUser, @Param('code') code: string, @Body() body: unknown) {
    return this.invitations.create(u.id, code, parse(inviteSchema, body).userId);
  }
}

@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.invitations.listForUser(u.id);
  }

  @Post(':id/accept')
  accept(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.invitations.accept(u.id, id);
  }

  @Post(':id/decline')
  decline(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.invitations.decline(u.id, id);
  }
}
