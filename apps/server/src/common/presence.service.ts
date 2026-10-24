import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { PrismaService } from './prisma.module';
import { REDIS } from './redis.module';

export type PresenceStatus = 'online' | 'playing' | 'offline';
const TTL_SEC = 90; // клиент шлёт heartbeat каждые ~30 с

/**
 * Присутствие игроков. Ключ `presence:<id>` живёт 90 секунд и продлевается heartbeat'ом клиента —
 * если сервер упал и не смог снять отметку, она сама истечёт.
 */
@Injectable()
export class PresenceService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

  touch(userId: string) {
    return this.redis.set(`presence:${userId}`, '1', 'EX', TTL_SEC);
  }

  async clear(userId: string) {
    await this.redis.del(`presence:${userId}`);
    await this.prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }

  async isOnline(userId: string): Promise<boolean> {
    return (await this.redis.exists(`presence:${userId}`)) === 1;
  }

  /** Статусы нескольких игроков. Если игрок скрыл статус в настройках — всегда «offline». */
  async statuses(ids: string[]): Promise<Map<string, PresenceStatus>> {
    const out = new Map<string, PresenceStatus>();
    if (ids.length === 0) return out;
    const [flags, playing, settings] = await Promise.all([
      this.redis.mget(ids.map((id) => `presence:${id}`)),
      this.prisma.matchPlayer.findMany({
        where: { userId: { in: ids }, result: null, match: { status: 'IN_PROGRESS' } },
        select: { userId: true },
      }),
      this.prisma.userSettings.findMany({ where: { userId: { in: ids }, showOnlineStatus: false }, select: { userId: true } }),
    ]);
    const playingSet = new Set(playing.map((p) => p.userId));
    const hidden = new Set(settings.map((s) => s.userId));
    ids.forEach((id, i) => {
      if (hidden.has(id) || !flags[i]) out.set(id, 'offline');
      else out.set(id, playingSet.has(id) ? 'playing' : 'online');
    });
    return out;
  }
}
