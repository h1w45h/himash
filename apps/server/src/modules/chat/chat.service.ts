import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { RealtimeError, normalizeRoomCode, type ChatMessageDto, type ChatSendDto } from '@nastolki/shared';
import { DomainEvents } from '../../common/events.module';
import { PrismaService } from '../../common/prisma.module';
import { REDIS } from '../../common/redis.module';
import { userBrief } from '../../common/social';

const RATE_LIMIT = 8; // сообщений
const RATE_WINDOW_SEC = 10;

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly events: DomainEvents,
  ) {}

  /** Определяет, к какой сущности относится сообщение, и проверяет, что отправитель — её участник. */
  private async resolve(userId: string, scope: 'ROOM' | 'MATCH', target: string) {
    if (scope === 'ROOM') {
      const room = await this.prisma.room.findUnique({
        where: { code: normalizeRoomCode(target) },
        select: { id: true, players: { select: { userId: true } } },
      });
      if (!room) throw new RealtimeError('NOT_FOUND', 'Комната не найдена');
      if (!room.players.some((p) => p.userId === userId)) throw new RealtimeError('FORBIDDEN', 'Вы не в этой комнате');
      return { roomId: room.id, matchId: null, key: `room:${room.id}` };
    }
    const match = await this.prisma.match.findUnique({
      where: { id: target },
      select: { id: true, players: { select: { userId: true } } },
    });
    if (!match) throw new RealtimeError('NOT_FOUND', 'Партия не найдена');
    if (!match.players.some((p) => p.userId === userId)) throw new RealtimeError('FORBIDDEN', 'Вы не участник партии');
    return { roomId: null, matchId: match.id, key: `match:${match.id}` };
  }

  async send(userId: string, dto: ChatSendDto): Promise<ChatMessageDto> {
    const rlKey = `chat:rl:${userId}`;
    const count = await this.redis.incr(rlKey);
    if (count === 1) await this.redis.expire(rlKey, RATE_WINDOW_SEC);
    if (count > RATE_LIMIT) throw new RealtimeError('RATE_LIMIT', 'Слишком часто. Подождите немного.');

    const t = await this.resolve(userId, dto.scope, dto.target);
    const row = await this.prisma.chatMessage.create({
      data: { scope: dto.scope, senderId: userId, roomId: t.roomId, matchId: t.matchId, body: dto.body },
      include: { sender: { select: userBrief } },
    });
    const message = this.toDto(row);
    this.events.emit({ type: 'chat.message', roomKey: t.key, message });
    return message;
  }

  async history(userId: string, scope: 'ROOM' | 'MATCH', target: string): Promise<ChatMessageDto[]> {
    const t = await this.resolve(userId, scope, target);
    const rows = await this.prisma.chatMessage.findMany({
      where: t.roomId ? { roomId: t.roomId } : { matchId: t.matchId },
      include: { sender: { select: userBrief } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.reverse().map((r) => this.toDto(r));
  }

  private toDto(r: { id: string; scope: string; body: string; createdAt: Date; sender: ChatMessageDto['sender'] }): ChatMessageDto {
    return { id: r.id, scope: r.scope as ChatMessageDto['scope'], body: r.body, createdAt: r.createdAt.toISOString(), sender: r.sender };
  }
}
