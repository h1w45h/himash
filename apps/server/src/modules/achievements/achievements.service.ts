import { Injectable, Logger } from '@nestjs/common';
import { ACHIEVEMENTS, type AchievementDef } from '@nastolki/shared';
import { PrismaService } from '../../common/prisma.module';
import { NotificationsService } from '../notifications/notifications.service';

interface Metrics {
  wins: Map<string, number>;
  games: Map<string, number>;
  totalWins: number;
  totalGames: number;
  distinct: number;
  maxRating: Map<string, number>;
  bestRating: number;
  friends: number;
}

export function progressFor(def: AchievementDef, m: Metrics): number {
  const r = def.rule;
  switch (r.type) {
    case 'wins': return r.game ? (m.wins.get(r.game) ?? 0) : m.totalWins;
    case 'games': return r.game ? (m.games.get(r.game) ?? 0) : m.totalGames;
    case 'rating': return r.game ? (m.maxRating.get(r.game) ?? 0) : m.bestRating;
    case 'distinctGames': return m.distinct;
    case 'friends': return m.friends;
  }
}

@Injectable()
export class AchievementsService {
  private readonly log = new Logger(AchievementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private async metrics(userId: string): Promise<Metrics> {
    const [rows, ratings, friends] = await Promise.all([
      this.prisma.matchPlayer.findMany({
        where: { userId, result: { not: null }, match: { status: 'FINISHED' } },
        select: { result: true, match: { select: { game: { select: { slug: true } } } } },
      }),
      this.prisma.rating.findMany({ where: { userId }, select: { peak: true, game: { select: { slug: true } } } }),
      this.prisma.friendship.count({ where: { status: 'ACCEPTED', OR: [{ requesterId: userId }, { addresseeId: userId }] } }),
    ]);
    const wins = new Map<string, number>();
    const games = new Map<string, number>();
    let totalWins = 0;
    for (const r of rows) {
      const slug = r.match.game.slug;
      games.set(slug, (games.get(slug) ?? 0) + 1);
      if (r.result === 'WIN') {
        totalWins++;
        wins.set(slug, (wins.get(slug) ?? 0) + 1);
      }
    }
    const maxRating = new Map(ratings.map((r) => [r.game.slug, r.peak]));
    return {
      wins, games, totalWins, totalGames: rows.length, distinct: games.size, maxRating,
      bestRating: Math.max(0, ...ratings.map((r) => r.peak)), friends,
    };
  }

  /** Пересчитывает прогресс всех достижений игрока и выдаёт заслуженные. Идемпотентно. */
  async evaluate(userId: string): Promise<string[]> {
    const [m, defs, mine] = await Promise.all([
      this.metrics(userId),
      this.prisma.achievement.findMany(),
      this.prisma.userAchievement.findMany({ where: { userId } }),
    ]);
    const done = new Set(mine.filter((x) => x.unlockedAt).map((x) => x.achievementId));
    const catalog = new Map(ACHIEVEMENTS.map((d) => [d.key, d]));
    const unlocked: string[] = [];

    for (const row of defs) {
      const def = catalog.get(row.key);
      if (!def || done.has(row.id)) continue;
      const progress = Math.min(progressFor(def, m), def.target);
      const prev = mine.find((x) => x.achievementId === row.id)?.progress ?? -1;
      if (progress !== prev) {
        await this.prisma.userAchievement.upsert({
          where: { userId_achievementId: { userId, achievementId: row.id } },
          create: { userId, achievementId: row.id, progress },
          update: { progress },
        });
      }
      if (progress < def.target) continue;

      // Выдача ровно один раз даже при параллельных вызовах: выигрывает тот, кто первым проставил unlockedAt.
      const won = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.userAchievement.updateMany({
          where: { userId, achievementId: row.id, unlockedAt: null },
          data: { unlockedAt: new Date(), progress },
        });
        if (claimed.count === 0) return false;
        if (def.reward > 0) {
          await tx.wallet.upsert({ where: { userId }, create: { userId, coins: def.reward }, update: { coins: { increment: def.reward } } });
          await tx.walletTransaction.create({
            data: { userId, currency: 'COINS', amount: def.reward, reason: 'ACHIEVEMENT', refId: def.key, idempotencyKey: `ach:${userId}:${def.key}` },
          });
        }
        return true;
      });
      if (won) {
        unlocked.push(def.key);
        await this.notifications.notify(userId, {
          type: 'ACHIEVEMENT',
          title: `Достижение: ${def.title}`,
          body: def.reward ? `${def.description}. Награда: ${def.reward} монет` : def.description,
          data: { key: def.key },
          pushWhenOnline: false,
        });
      }
    }
    return unlocked;
  }

  /** Вызывается после завершения партии для каждого живого участника. */
  async onMatchFinished(matchId: string) {
    const players = await this.prisma.matchPlayer.findMany({ where: { matchId, userId: { not: null }, isBot: false }, select: { userId: true } });
    for (const p of players) await this.evaluate(p.userId as string).catch((e) => this.log.warn(`достижения ${p.userId}: ${(e as Error).message}`));
  }

  async list(userId: string) {
    const [defs, mine] = await Promise.all([this.prisma.achievement.findMany(), this.prisma.userAchievement.findMany({ where: { userId } })]);
    const byId = new Map(mine.map((m) => [m.achievementId, m]));
    const order = new Map(ACHIEVEMENTS.map((d, i) => [d.key, i]));
    return defs
      .map((d) => {
        const ua = byId.get(d.id);
        return {
          key: d.key, title: d.title, description: d.description, rarity: d.rarity, target: d.target,
          reward: d.rewardCoins, gameSlug: ACHIEVEMENTS.find((x) => x.key === d.key)?.gameSlug ?? null,
          progress: ua?.progress ?? 0, unlockedAt: ua?.unlockedAt ?? null, hidden: d.hidden,
        };
      })
      .filter((d) => !d.hidden || d.unlockedAt)
      .sort((a, b) => Number(!!b.unlockedAt) - Number(!!a.unlockedAt) || (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
  }
}
