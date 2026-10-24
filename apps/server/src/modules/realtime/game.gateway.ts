import { Logger, OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayInit, SubscribeMessage, WebSocketGateway,
} from '@nestjs/websockets';
import type { ZodType, ZodTypeDef } from 'zod';
import type { Namespace, Socket } from 'socket.io';
import type { Subscription } from 'rxjs';
import {
  GameEvents, RealtimeError, SocialEvents, chatSendSchema, matchActionSchema, matchJoinEventSchema,
  matchResyncSchema, roomJoinEventSchema, type Ack,
} from '@nastolki/shared';
import type { User } from '@prisma/client';
import { DomainEvents, type DomainEvent } from '../../common/events.module';
import { AuthService } from '../auth/auth.service';
import { ChatService } from '../chat/chat.service';
import { MatchRuntime } from '../matches/match-runtime.service';
import { RoomsService } from '../rooms/rooms.service';

type AuthedSocket = Socket & { data: { user: User } };

/** Выполняет обработчик и превращает исключения в Ack с кодом ошибки. */
async function ack<T>(fn: () => Promise<T>): Promise<Ack<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof RealtimeError) return { ok: false, code: e.code, message: e.message };
    const status = (e as { status?: number; response?: { message?: string } }).status;
    if (status) return { ok: false, code: status === 404 ? 'NOT_FOUND' : status === 403 ? 'FORBIDDEN' : 'INVALID', message: (e as Error).message };
    new Logger('GameGateway').error(e as Error);
    return { ok: false, code: 'INVALID', message: 'Внутренняя ошибка сервера' };
  }
}

function input<T>(schema: ZodType<T, ZodTypeDef, unknown>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new RealtimeError('INVALID', r.error.issues.map((i) => i.message).join('; '));
  return r.data;
}

const seatRoom = (matchId: string, seat: number) => `match:${matchId}:seat:${seat}`;

@WebSocketGateway({ namespace: '/game' })
export class GameGateway implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy {
  private ns!: Namespace;
  private sub?: Subscription;

  constructor(
    private readonly auth: AuthService,
    private readonly rooms: RoomsService,
    private readonly runtime: MatchRuntime,
    private readonly chat: ChatService,
    private readonly events: DomainEvents,
  ) {}

  afterInit(ns: Namespace) {
    this.ns = ns;
    // Аутентификация на рукопожатии: без валидного JWT Clerk соединение не устанавливается.
    ns.use(async (socket, next) => {
      const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
      if (!token) return next(new Error('UNAUTHORIZED'));
      try {
        socket.data.user = await this.auth.authenticate(token);
        next();
      } catch {
        next(new Error('UNAUTHORIZED'));
      }
    });
    this.sub = this.events.stream.subscribe((e) => void this.dispatchEvent(e).catch(() => undefined));
  }

  onModuleDestroy() {
    this.sub?.unsubscribe();
  }

  handleConnection(socket: AuthedSocket) {
    void socket.join(`user:${socket.data.user.id}`); // личный канал: приглашения, найденные матчи
  }

  // ───────── события домена → клиенты ─────────

  private async dispatchEvent(ev: DomainEvent): Promise<void> {
    switch (ev.type) {
      case 'room.updated': {
        const view = await this.rooms.get(ev.code);
        this.ns.to(`room:${ev.roomId}`).emit(GameEvents.RoomUpdated, view);
        break;
      }
      case 'room.closed':
        this.ns.to(`room:${ev.roomId}`).emit('room:closed', { code: ev.code });
        break;
      case 'match.started':
        for (const id of ev.userIds) this.ns.to(`user:${id}`).emit('match:started', { matchId: ev.matchId });
        break;
      case 'matchmaking.found':
        for (const id of ev.userIds) this.ns.to(`user:${id}`).emit(GameEvents.MatchmakingFound, { roomCode: ev.roomCode, matchId: ev.matchId });
        break;
      case 'match.updated':
        for (const [seat, payload] of Object.entries(ev.payloads)) {
          const room = seatRoom(ev.matchId, Number(seat));
          this.ns.to(room).emit(GameEvents.MatchUpdate, payload);
          if (ev.ended) this.ns.to(room).emit(GameEvents.MatchEnded, payload);
        }
        break;
      case 'chat.message':
        this.ns.to(ev.roomKey).emit(GameEvents.ChatMessage, ev.message);
        break;
      case 'invitation.created':
        this.ns.to(`user:${ev.receiverId}`).emit(SocialEvents.Invite, { invitationId: ev.invitationId });
        break;
    }
  }

  // ───────── комнаты ─────────

  @SubscribeMessage(GameEvents.RoomJoin)
  roomJoin(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return ack(async () => {
      const { code } = input(roomJoinEventSchema, body);
      const room = await this.rooms.get(code);
      if (!room.players.some((p) => p.user?.id === s.data.user.id)) throw new RealtimeError('FORBIDDEN', 'Вы не в этой комнате');
      await s.join(`room:${room.id}`);
      return room;
    });
  }

  @SubscribeMessage(GameEvents.RoomLeave)
  roomLeave(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return ack(async () => {
      const { code } = input(roomJoinEventSchema, body);
      const room = await this.rooms.get(code).catch(() => null);
      if (room) await s.leave(`room:${room.id}`);
      return undefined;
    });
  }

  // ───────── партии ─────────

  /** Вход в партию и реконнект: возвращает полный снимок, после чего клиент получает инкременты. */
  @SubscribeMessage(GameEvents.MatchResync)
  matchResync(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return ack(async () => {
      const { matchId } = input(matchResyncSchema, body);
      const snap = await this.runtime.snapshotFor(s.data.user.id, matchId);
      await s.join([`match:${matchId}`, seatRoom(matchId, snap.seat ?? -1)]);
      return snap;
    });
  }

  @SubscribeMessage(GameEvents.MatchAction)
  matchAction(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return ack(async () => {
      const dto = input(matchActionSchema, body);
      try {
        return await this.runtime.applyAction(s.data.user.id, dto.matchId, dto.expectedVersion, dto.action);
      } catch (e) {
        // Клиент отстал — сразу отдаём актуальный снимок, чтобы не делать лишний круг.
        if (e instanceof RealtimeError && e.code === 'STALE') {
          const snap = await this.runtime.snapshotFor(s.data.user.id, dto.matchId);
          s.emit(GameEvents.MatchUpdate, { ...snap, lastAction: null });
        }
        throw e;
      }
    });
  }

  @SubscribeMessage('match:resign')
  matchResign(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return ack(async () => {
      const { matchId } = input(matchJoinEventSchema, body);
      await this.runtime.resign(s.data.user.id, matchId);
      return undefined;
    });
  }

  // ───────── чат ─────────

  @SubscribeMessage(GameEvents.ChatSend)
  chatSend(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return ack(() => this.chat.send(s.data.user.id, input(chatSendSchema, body)));
  }
}
