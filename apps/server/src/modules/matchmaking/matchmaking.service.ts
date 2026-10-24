import {
  BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { hasGame } from '@nastolki/game-engine';
import type { MatchmakingJoinDto, MatchmakingStatus } from '@nastolki/shared';
import { DomainEvents } from '../../common/events.module';
import { PrismaService } from '../../common/prisma.module';
import { REDIS } from '../../common/redis.module';
import { RoomsService } from '../rooms/rooms.service';
import { formGroups, type Ticket } from './matchmaking-logic';

const TICKET_TTL_SEC = 300; // билет «протухает», если клиент пропал
const FOUND_TTL_SEC = 120; // результат подбора ждёт клиента, даже если сокет был оффлайн
const TICK_MS = 1000;

const kTicket = (userId: string) => `mm:ticket:${userId}`;
const kQueue = (game: string, variant: string) => `mm:queue:${game}:${variant}`;
const kFound = (userId: string) => `mm:found:${userId}`;
const K_QUEUES = 'mm:queues';
const K_LOCK = 'mm:tick:lock';

interface StoredTicket extends Ticket {
  gameSlug: string;
  variant: string;
}

/**
 * Матчмейкинг на Redis.
 *  - билет игрока: ключ с TTL;
 *  - очередь: множество userId на (игра, вариант);
 *  - тикер раз в секунду берёт распределённую блокировку, поэтому при нескольких инстансах
 *    сервера подбор выполняет ровно один.
 * Результат пишется в `mm:found:<userId>` — клиент получает его и через сокет, и через опрос статуса.
 */
@Injectable()
export class MatchmakingService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(MatchmakingService.name);
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly events: DomainEvents,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async join(userId: string, dto: MatchmakingJoinDto): Promise<MatchmakingStatus> {
    const game = await this.prisma.game.findUnique({ where: { slug: dto.gameSlug } });
    if (!game) throw new NotFoundException('Игра не найдена');
    if (!game.supportsOnline || !hasGame(game.slug)) throw new BadRequestException('Игра пока недоступна для онлайна');

    await this.leave(userId); // повторный вход = перепостановка в очередь
    await this.redis.del(kFound(userId));
    await this.rooms.assertFree(userId);

    const rating = await this.prisma.rating.findUnique({ where: { userId_gameId: { userId, gameId: game.id } } });
    const variant = dto.variantKey ?? 'default';
    const ticket: StoredTicket = {
      userId, gameSlug: game.slug, variant, rating: rating?.rating ?? 1200, joinedAt: Date.now(),
    };
    const queue = kQueue(game.slug, variant);
    await this.redis
      .multi()
      .set(kTicket(userId), JSON.stringify(ticket), 'EX', TICKET_TTL_SEC)
      .sadd(queue, userId)
      .sadd(K_QUEUES, queue)
      .exec();
    return { state: 'searching', gameSlug: game.slug, waitedMs: 0 };
  }

  async leave(userId: string): Promise<{ ok: true }> {
    const raw = await this.redis.get(kTicket(userId));
    if (raw) {
      const t = JSON.parse(raw) as StoredTicket;
      await this.redis.multi().srem(kQueue(t.gameSlug, t.variant), userId).del(kTicket(userId)).exec();
    }
    return { ok: true };
  }

  async status(userId: string): Promise<MatchmakingStatus> {
    const found = await this.redis.get(kFound(userId));
    if (found) {
      const f = JSON.parse(found) as { roomCode: string; matchId: string };
      return { state: 'found', ...f };
    }
    const raw = await this.redis.get(kTicket(userId));
    if (raw) {
      const t = JSON.parse(raw) as StoredTicket;
      await this.redis.expire(kTicket(userId), TICKET_TTL_SEC); // опрос = «я ещё здесь»
      return { state: 'searching', gameSlug: t.gameSlug, waitedMs: Date.now() - t.joinedAt };
    }
    return { state: 'idle' };
  }

  // ───────── тикер ─────────

  private async tick() {
    if (this.ticking) return; // предыдущий тик ещё не закончился
    this.ticking = true;
    try {
      const locked = await this.redis.set(K_LOCK, '1', 'PX', TICK_MS - 100, 'NX');
      if (!locked) return;
      const queues = await this.redis.smembers(K_QUEUES);
      for (const queue of queues) await this.processQueue(queue);
    } catch (e) {
      this.log.error('Ошибка тикера матчмейкинга', e as Error);
    } finally {
      this.ticking = false;
    }
  }

  private async processQueue(queue: string) {
    const ids = await this.redis.smembers(queue);
    if (ids.length === 0) {
      await this.redis.srem(K_QUEUES, queue);
      return;
    }
    const raws = await this.redis.mget(ids.map(kTicket));
    const tickets: StoredTicket[] = [];
    const dead: string[] = [];
    raws.forEach((raw, i) => {
      if (raw) tickets.push(JSON.parse(raw) as StoredTicket);
      else dead.push(ids[i] as string); // билет истёк — чистим очередь
    });
    if (dead.length) await this.redis.srem(queue, ...dead);

    const first = tickets[0];
    if (!first) return;
    const game = await this.prisma.game.findUnique({ where: { slug: first.gameSlug } });
    if (!game) return;

    const groups = formGroups(tickets, game.minPlayers, game.maxPlayers, Date.now());
    for (const group of groups) {
      const userIds = group.map((t) => t.userId);
      try {
        const room = await this.rooms.createMatched(
          game.slug,
          first.variant === 'default' ? null : first.variant,
          userIds,
        );
        if (!room.matchId) throw new Error('Партия не создана');
        const payload = JSON.stringify({ roomCode: room.code, matchId: room.matchId });
        const m = this.redis.multi();
        for (const id of userIds) m.srem(queue, id).del(kTicket(id)).set(kFound(id), payload, 'EX', FOUND_TTL_SEC);
        await m.exec();
        this.events.emit({ type: 'matchmaking.found', userIds, roomCode: room.code, matchId: room.matchId });
      } catch (e) {
        // Например, игрок успел зайти в другую партию — оставляем билеты, повторим на следующем тике.
        this.log.warn(`Не удалось создать матч: ${(e as Error).message}`);
      }
    }
  }
}
