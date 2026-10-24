import { ConflictException, Injectable } from '@nestjs/common';
import { DAILY_BONUS } from '@nastolki/shared';
import { PrismaService } from '../../common/prisma.module';

/** Игровой день считаем по московскому времени — основная аудитория в России. */
export const dayKey = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
const prevDay = (key: string) => dayKey(new Date(Date.parse(`${key}T12:00:00Z`) - 86_400_000));

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  private async lastDaily(userId: string) {
    return this.prisma.walletTransaction.findFirst({ where: { userId, reason: 'DAILY_BONUS' }, orderBy: { createdAt: 'desc' } });
  }

  async get(userId: string, now = new Date()) {
    const [wallet, last, history] = await Promise.all([
      this.prisma.wallet.upsert({ where: { userId }, create: { userId }, update: {} }),
      this.lastDaily(userId),
      this.prisma.walletTransaction.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    const today = dayKey(now);
    const lastDay = last ? dayKey(last.createdAt) : null;
    const claimedToday = lastDay === today;
    const streak = last && (claimedToday || lastDay === prevDay(today)) ? Number(last.refId ?? 1) : 0;
    const nextStreak = claimedToday ? streak : streak + 1;
    return {
      coins: wallet.coins, gems: wallet.gems, history,
      daily: { available: !claimedToday, streak, nextBonus: DAILY_BONUS[Math.min(nextStreak, DAILY_BONUS.length) - 1], schedule: DAILY_BONUS },
    };
  }

  async claimDaily(userId: string, now = new Date()) {
    const state = await this.get(userId, now);
    if (!state.daily.available) throw new ConflictException('Бонус за сегодня уже получен');
    const streak = state.daily.streak + 1;
    const amount = DAILY_BONUS[Math.min(streak, DAILY_BONUS.length) - 1] as number;
    try {
      await this.prisma.$transaction([
        this.prisma.wallet.upsert({ where: { userId }, create: { userId, coins: amount }, update: { coins: { increment: amount } } }),
        this.prisma.walletTransaction.create({
          // Ключ по дню: двойной тап или гонка двух запросов не начислят бонус дважды.
          data: { userId, currency: 'COINS', amount, reason: 'DAILY_BONUS', refId: String(streak), idempotencyKey: `daily:${userId}:${dayKey(now)}`, createdAt: now },
        }),
      ]);
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException('Бонус за сегодня уже получен');
      throw e;
    }
    return { amount, streak };
  }
}
