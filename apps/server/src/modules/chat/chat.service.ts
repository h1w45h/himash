import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { getGameOrNull } from '@nastolki/game-engine';
import { RealtimeError, normalizeRoomCode, type ChatMessageDto, type ChatSendDto } from '@nastolki/shared';
import { DomainEvents } from '../../common/events.module';
import { PrismaService } from '../../common/prisma.module';
import { REDIS } from '../../common/redis.module';
import { areFriends, isBlockedBetween, userBrief } from '../../common/social';
import { NotificationsService } from '../notifications/notifications.service';

const RATE_LIMIT = 8; // сообщений
const RATE_WINDOW_SEC = 10;

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly events: DomainEvents,
    private readonly notifications: NotificationsService,
  ) {}

  /** Определяет, к какой сущности относится сообщение, и проверяет, что отправитель — её участник. */
  private async resolve(userId: string, scope: 'ROOM' | 'MATCH' | 'DIRECT', target: string, forWriting = false) {
    if (scope === 'DIRECT') {
      if (target === userId) throw new RealtimeError('INVALID', 'Нельзя писать самому себе');
      if (await isBlockedBetween(this.prisma, userId, target)) throw new RealtimeError('FORBIDDEN', 'Переписка недоступна');
      if (!(await areFriends(this.prisma, userId, target))) throw new RealtimeError('FORBIDDEN', 'Писать можно только друзьям');
      // Личное сообщение доставляется на оба аккаунта: получателю и другим устройствам отправителя.
      return { roomId: null, matchId: null, recipientId: target, keys: [`user:${target}`, `user:${userId}`] };
    }
    if (scope === 'ROOM') {
      const room = await this.prisma.room.findUnique({
        where: { code: normalizeRoomCode(target) },
        select: { id: true, players: { select: { userId: true } } },
      });
      if (!room) throw new RealtimeError('NOT_FOUND', 'Комната не найдена');
      if (!room.players.some((p) => p.userId === userId)) throw new RealtimeError('FORBIDDEN', 'Вы не в этой комнате');
      return { roomId: room.id, matchId: null, recipientId: null, keys: [`room:${room.id}`] };
    }
    const match = await this.prisma.match.findUnique({
      where: { id: target },
      select: { id: true, state: true, players: { select: { userId: true, seat: true } }, game: { select: { slug: true } } },
    });
    if (!match) throw new RealtimeError('NOT_FOUND', 'Партия не найдена');
    const mine = match.players.find((p) => p.userId === userId);
    if (!mine) throw new RealtimeError('FORBIDDEN', 'Вы не участник партии');
    // Игра может ограничивать чат (ночью в «Мафии», для выбывших игроков).
    if (forWriting && getGameOrNull(match.game.slug)?.chatAllowed?.(match.state, mine.seat) === false) {
      throw new RealtimeError('FORBIDDEN', 'Сейчас писать в чат нельзя');
    }
    return { roomId: null, matchId: match.id, recipientId: null, keys: [`match:${match.id}`] };
  }

  async send(userId: string, dto: ChatSendDto): Promise<ChatMessageDto> {
    const rlKey = `chat:rl:${userId}`;
    const count = await this.redis.incr(rlKey);
    if (count === 1) await this.redis.expire(rlKey, RATE_WINDOW_SEC);
    if (count > RATE_LIMIT) throw new RealtimeError('RATE_LIMIT', 'Слишком часто. Подождите немного.');

    const t = await this.resolve(userId, dto.scope, dto.target, true);
    const row = await this.prisma.chatMessage.create({
      data: { scope: dto.scope, senderId: userId, roomId: t.roomId, matchId: t.matchId, recipientId: t.recipientId, body: dto.body },
      include: { sender: { select: userBrief } },
    });
    const message = this.toDto(row);
    for (const roomKey of t.keys) this.events.emit({ type: 'chat.message', roomKey, message });
    if (t.recipientId) {
      // Офлайн-получатель узнает о сообщении из push.
      await this.notifications.pushOnly(t.recipientId, {
        type: 'SYSTEM', title: row.sender?.displayName ?? 'Новое сообщение', body: dto.body.slice(0, 120), data: { userId, kind: 'dm' },
      });
    }
    return message;
  }

  async history(userId: string, scope: 'ROOM' | 'MATCH' | 'DIRECT', target: string): Promise<ChatMessageDto[]> {
    const t = await this.resolve(userId, scope, target);
    const rows = await this.prisma.chatMessage.findMany({
      where: t.recipientId
        ? { scope: 'DIRECT', OR: [{ senderId: userId, recipientId: target }, { senderId: target, recipientId: userId }] }
        : t.roomId ? { roomId: t.roomId } : { matchId: t.matchId },
      include: { sender: { select: userBrief } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.reverse().map((r) => this.toDto(r));
  }

  async markRead(userId: string, otherId: string) {
    await this.prisma.chatMessage.updateMany({ where: { scope: 'DIRECT', senderId: otherId, recipientId: userId, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }

  private toDto(r: { id: string; scope: string; recipientId: string | null; body: string; createdAt: Date; sender: ChatMessageDto['sender'] }): ChatMessageDto {
    return { id: r.id, scope: r.scope as ChatMessageDto['scope'], recipientId: r.recipientId, body: r.body, createdAt: r.createdAt.toISOString(), sender: r.sender };
  }
}
