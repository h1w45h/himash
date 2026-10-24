import { ConflictException, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type Redis from 'ioredis';
import { dispatch, getGame, type Outcome, type Session } from '@nastolki/game-engine';
import { RealtimeError, type MatchSnapshot, type MatchUpdate } from '@nastolki/shared';
import type { Prisma } from '@prisma/client';
import { DomainEvents } from '../../common/events.module';
import { PrismaService } from '../../common/prisma.module';
import { REDIS } from '../../common/redis.module';
import { PresenceService } from '../../common/presence.service';
import { AchievementsService } from '../achievements/achievements.service';
import { NotificationsService } from '../notifications/notifications.service';
import { rateMatch, type RatingState } from './rating/glicko2';

const matchInclude = {
  players: { include: { user: { select: { displayName: true, avatarUrl: true } } }, orderBy: { seat: 'asc' } },
  game: { select: { slug: true, hasBots: true } },
  room: { select: { code: true, turnTimeSec: true } },
} satisfies Prisma.MatchInclude;
type MatchFull = Prisma.MatchGetPayload<{ include: typeof matchInclude }>;

const REWARD = { WIN: 30, DRAW: 15, LOSS: 10 } as const;
const BOT_DELAY_MS = [700, 1500] as const;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Серверный «арбитр» партии. Единственное место, где меняется состояние матча.
 *
 * Гарантии:
 *  - ходы одной партии выполняются строго по очереди (Redis-блокировка + оптимистичная версия в БД);
 *  - состояние и запись в журнал ходов — в одной транзакции;
 *  - окончание партии (результаты, рейтинг, награды) — в той же транзакции, что и последний ход.
 */
@Injectable()
export class MatchRuntime implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(MatchRuntime.name);
  private sweeper?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly events: DomainEvents,
    private readonly presence: PresenceService,
    private readonly notifications: NotificationsService,
    private readonly achievements: AchievementsService,
  ) {}

  async onModuleInit() {
    this.sweeper = setInterval(() => void this.sweepTimeouts(), 1000);
    this.sweeper.unref();
    // После рестарта сервера боты в идущих партиях должны продолжить ходить.
    const live = await this.prisma.match.findMany({ where: { status: 'IN_PROGRESS' }, select: { id: true } });
    for (const m of live) this.scheduleBot(m.id);
  }
  onModuleDestroy() {
    if (this.sweeper) clearInterval(this.sweeper);
  }

  // ───────── блокировка ─────────

  private async withLock<T>(matchId: string, fn: () => Promise<T>): Promise<T> {
    const key = `match:lock:${matchId}`;
    const token = randomUUID();
    for (let i = 0; i < 40; i++) {
      if (await this.redis.set(key, token, 'PX', 5000, 'NX')) {
        try {
          return await fn();
        } finally {
          // Снимаем только свою блокировку (на случай, если истёк TTL и её взял другой).
          await this.redis.eval(
            "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
            1, key, token,
          );
        }
      }
      await sleep(50);
    }
    throw new ConflictException('Партия занята, повторите действие');
  }

  private load(matchId: string): Promise<MatchFull | null> {
    return this.prisma.match.findUnique({ where: { id: matchId }, include: matchInclude });
  }

  // ───────── представления ─────────

  /** Снимок партии для места `seat` (null — наблюдатель). */
  snapshot(m: MatchFull, seat: number | null): MatchSnapshot {
    const game = getGame(m.game.slug);
    const seats = m.status === 'IN_PROGRESS' ? game.currentSeats(m.state) : [];
    return {
      matchId: m.id,
      gameSlug: m.game.slug,
      variantKey: m.variantKey,
      roomCode: m.room?.code ?? null,
      status: m.status,
      seat,
      version: m.stateVersion,
      view: game.view(m.state, seat),
      legal: seat !== null && seats.includes(seat) ? game.legalActions(m.state, seat) : [],
      currentSeats: seats,
      turnDeadline: m.turnDeadline?.toISOString() ?? null,
      players: m.players.map((p) => ({
        seat: p.seat,
        userId: p.userId,
        displayName: p.isBot ? `Бот (${p.botLevel ?? 'MEDIUM'})` : (p.user?.displayName ?? 'Игрок'),
        avatarUrl: p.user?.avatarUrl ?? null,
        isBot: p.isBot,
        result: p.result,
        ratingDelta: p.ratingDelta,
      })),
      outcome: m.status === 'IN_PROGRESS' ? null : this.storedOutcome(m),
    };
  }

  private storedOutcome(m: MatchFull): MatchSnapshot['outcome'] {
    const game = getGame(m.game.slug);
    // Сдача и таймаут в состоянии игры не видны, поэтому причина и победители хранятся в самой партии.
    if (m.endReason === 'resign' || m.endReason === 'timeout' || m.endReason === 'abandoned') {
      const rest = m.players.map((p) => p.seat).filter((s) => !m.winnerSeats.includes(s));
      return { winners: m.winnerSeats, ranking: [...m.winnerSeats, ...rest], reason: m.endReason };
    }
    const o = m.status === 'FINISHED' ? game.outcome(m.state) : null;
    return o ?? { winners: m.winnerSeats, ranking: m.winnerSeats, reason: m.endReason ?? 'finished' };
  }

  async snapshotFor(userId: string, matchId: string): Promise<MatchSnapshot> {
    const m = await this.load(matchId);
    if (!m) throw new RealtimeError('NOT_FOUND', 'Партия не найдена');
    const me = m.players.find((p) => p.userId === userId);
    if (!me) throw new RealtimeError('FORBIDDEN', 'Вы не участник этой партии');
    return this.snapshot(m, me.seat);
  }

  private publish(m: MatchFull, lastAction: MatchUpdate['lastAction'], actor: number | null, rawAction: unknown) {
    const game = getGame(m.game.slug);
    const payloads: Record<number, MatchUpdate> = {};
    for (const p of m.players) {
      if (p.isBot && !p.userId) continue;
      const snap = this.snapshot(m, p.seat);
      const { variantKey: _v, roomCode: _r, gameSlug: _g, ...rest } = snap;
      const shown =
        lastAction && actor !== null
          ? { seat: actor, action: game.redactAction ? game.redactAction(rawAction, actor, p.seat) : rawAction }
          : lastAction;
      payloads[p.seat] = { ...rest, lastAction: shown };
    }
    this.events.emit({ type: 'match.updated', matchId: m.id, payloads, ended: m.status !== 'IN_PROGRESS' });
    if (m.status === 'IN_PROGRESS') void this.pushTurns(m, actor).catch(() => undefined);
    else if (m.status === 'FINISHED') void this.achievements.onMatchFinished(m.id).catch(() => undefined);
  }

  /** Игроку, которого нет в приложении, отправляем push «Ваш ход» (не чаще раза в 5 минут на партию). */
  private async pushTurns(m: MatchFull, actor: number | null) {
    const game = getGame(m.game.slug);
    for (const seat of game.currentSeats(m.state)) {
      const p = m.players.find((x) => x.seat === seat);
      if (!p?.userId || p.isBot || seat === actor || (await this.presence.isOnline(p.userId))) continue;
      const first = await this.redis.set(`turnpush:${m.id}:${p.userId}`, '1', 'EX', 300, 'NX');
      if (first) {
        await this.notifications.pushOnly(p.userId, {
          type: 'YOUR_TURN', title: 'Ваш ход', body: `Соперник сходил — партия ждёт вас`, data: { matchId: m.id },
        });
      }
    }
  }

  // ───────── ходы ─────────

  async applyAction(userId: string, matchId: string, expectedVersion: number, action: unknown): Promise<{ version: number }> {
    return this.withLock(matchId, async () => {
      const m = await this.load(matchId);
      if (!m) throw new RealtimeError('NOT_FOUND', 'Партия не найдена');
      const me = m.players.find((p) => p.userId === userId);
      if (!me || me.isBot || me.result === 'LEFT') throw new RealtimeError('FORBIDDEN', 'Вы не участвуете в этой партии');
      if (m.status !== 'IN_PROGRESS') throw new RealtimeError('INVALID', 'Партия уже завершена');
      if (m.stateVersion !== expectedVersion) throw new RealtimeError('STALE', 'Состояние партии устарело');
      return this.step(m, me.seat, action);
    });
  }

  /** Один шаг: валидация → применение → запись → рассылка. Вызывается под блокировкой. */
  private async step(m: MatchFull, seat: number, action: unknown): Promise<{ version: number }> {
    const session: Session = { slug: m.game.slug, state: m.state, version: m.stateVersion, log: [] };
    const r = dispatch(session, seat, action);
    if (!r.ok) throw new RealtimeError('INVALID', r.error);

    const game = getGame(m.game.slug);
    const state = r.session.state;
    const version = r.session.version;
    const seats = game.currentSeats(state);
    const turnSec = m.room?.turnTimeSec;

    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.match.updateMany({
        where: { id: m.id, stateVersion: m.stateVersion, status: 'IN_PROGRESS' },
        data: {
          state: state as Prisma.InputJsonValue,
          stateVersion: version,
          currentSeat: r.outcome ? null : (seats[0] ?? null),
          turnDeadline: r.outcome || !turnSec ? null : new Date(Date.now() + turnSec * 1000),
        },
      });
      if (claimed.count === 0) throw new RealtimeError('STALE', 'Состояние партии устарело');
      await tx.matchMove.create({
        data: { matchId: m.id, index: version, seat, action: action as Prisma.InputJsonValue },
      });
      if (r.outcome) await this.finish(tx, m, r.outcome);
      return tx.match.findUniqueOrThrow({ where: { id: m.id }, include: matchInclude });
    });

    this.publish(updated, { seat, action }, seat, action);
    if (updated.status === 'IN_PROGRESS') this.scheduleBot(m.id);
    return { version };
  }

  // ───────── завершение ─────────

  /** Записывает итоги внутри транзакции: результаты, рейтинг Glicko-2, награды, статус комнаты. */
  private async finish(tx: Prisma.TransactionClient, m: MatchFull, outcome: Outcome) {
    const winners = new Set(outcome.winners);
    const place = new Map<number, number>();
    outcome.ranking.forEach((s, i) => place.set(s, i + 1));
    const worst = m.players.length;

    const humans = m.players.filter((p) => p.userId && !p.isBot);
    const ratedHere = m.isRated && humans.length >= 2 && humans.length === m.players.length;

    // Рейтинг
    const deltas = new Map<number, { before: number; after: number }>();
    const ratings = new Map<string, { id: string; state: RatingState; wins: number; losses: number; draws: number; peak: number }>();
    if (ratedHere) {
      const rows = await tx.rating.findMany({ where: { gameId: m.gameId, userId: { in: humans.map((h) => h.userId as string) } } });
      for (const p of humans) {
        const row = rows.find((x) => x.userId === p.userId);
        ratings.set(p.userId as string, {
          id: row?.id ?? '',
          state: { rating: row?.rating ?? 1200, deviation: row?.deviation ?? 350, volatility: row?.volatility ?? 0.06 },
          wins: row?.wins ?? 0, losses: row?.losses ?? 0, draws: row?.draws ?? 0, peak: row?.peak ?? 1200,
        });
      }
      const next = rateMatch(
        humans.map((p) => ({
          seat: p.seat,
          state: (ratings.get(p.userId as string) as { state: RatingState }).state,
          // Сдавшиеся/вышедшие считаются последними.
          place: p.result === 'LEFT' ? worst + 1 : (place.get(p.seat) ?? (winners.has(p.seat) ? 1 : worst)),
        })),
      );
      for (const p of humans) {
        const r = ratings.get(p.userId as string)!;
        const n = next.get(p.seat)!;
        deltas.set(p.seat, { before: Math.round(r.state.rating), after: Math.round(n.rating) });
        const result = this.resultFor(p.seat, p.result, winners);
        await tx.rating.upsert({
          where: { userId_gameId: { userId: p.userId as string, gameId: m.gameId } },
          create: {
            userId: p.userId as string, gameId: m.gameId, rating: Math.round(n.rating), deviation: n.deviation,
            volatility: n.volatility, wins: result === 'WIN' ? 1 : 0, losses: result === 'WIN' || result === 'DRAW' ? 0 : 1,
            draws: result === 'DRAW' ? 1 : 0, peak: Math.max(1200, Math.round(n.rating)),
          },
          update: {
            rating: Math.round(n.rating), deviation: n.deviation, volatility: n.volatility,
            wins: { increment: result === 'WIN' ? 1 : 0 },
            losses: { increment: result === 'WIN' || result === 'DRAW' ? 0 : 1 },
            draws: { increment: result === 'DRAW' ? 1 : 0 },
            peak: Math.max(r.peak, Math.round(n.rating)),
          },
        });
      }
    }

    // Результаты игроков и награды
    for (const p of m.players) {
      const result = this.resultFor(p.seat, p.result, winners);
      const d = deltas.get(p.seat);
      await tx.matchPlayer.update({
        where: { id: p.id },
        data: {
          result,
          score: outcome.scores?.[p.seat] ?? null,
          ratingBefore: d?.before ?? null,
          ratingAfter: d?.after ?? null,
          ratingDelta: d ? d.after - d.before : null,
        },
      });
      // Награда только за партии минимум двух живых игроков — защита от фарма на ботах.
      if (p.userId && !p.isBot && humans.length >= 2 && result !== 'LEFT') {
        const coins = REWARD[result];
        await tx.wallet.upsert({
          where: { userId: p.userId },
          create: { userId: p.userId, coins },
          update: { coins: { increment: coins } },
        });
        await tx.walletTransaction.create({
          data: {
            userId: p.userId, currency: 'COINS', amount: coins, reason: 'MATCH_REWARD', refId: m.id,
            idempotencyKey: `match:${m.id}:${p.userId}`, // повторный вызов не начислит дважды
          },
        });
      }
    }

    await tx.match.update({
      where: { id: m.id },
      data: {
        status: 'FINISHED', finishedAt: new Date(), winnerSeats: outcome.winners, endReason: outcome.reason,
        currentSeat: null, turnDeadline: null,
      },
    });
    if (m.roomId) await tx.room.update({ where: { id: m.roomId }, data: { status: 'FINISHED', closedAt: new Date() } });
  }

  private resultFor(seat: number, current: string | null, winners: Set<number>): 'WIN' | 'LOSS' | 'DRAW' | 'LEFT' {
    if (current === 'LEFT') return 'LEFT';
    if (winners.size === 0) return 'DRAW';
    return winners.has(seat) ? 'WIN' : 'LOSS';
  }

  // ───────── сдача, выход, таймауты ─────────

  async resign(userId: string, matchId: string): Promise<void> {
    await this.withLock(matchId, async () => {
      const m = await this.load(matchId);
      if (!m) throw new RealtimeError('NOT_FOUND', 'Партия не найдена');
      const me = m.players.find((p) => p.userId === userId);
      if (!me || me.isBot || me.result === 'LEFT') throw new RealtimeError('FORBIDDEN', 'Вы не участвуете в этой партии');
      if (m.status !== 'IN_PROGRESS') throw new RealtimeError('INVALID', 'Партия уже завершена');
      await this.leaveSeat(m, me.seat, 'resign');
    });
  }

  /**
   * Игрок выбыл (сдался / не сходил вовремя).
   *  - вдвоём: победа соперника;
   *  - втроём и более: место занимает бот (если игра их поддерживает), иначе партия отменяется без рейтинга.
   */
  private async leaveSeat(m: MatchFull, seat: number, reason: 'resign' | 'timeout') {
    const active = m.players.filter((p) => p.result !== 'LEFT' && !p.isBot);
    await this.prisma.matchPlayer.updateMany({ where: { matchId: m.id, seat }, data: { result: 'LEFT' } });

    if (m.players.length === 2) {
      const other = m.players.find((p) => p.seat !== seat);
      const winner = other?.seat ?? 0;
      const fresh = (await this.load(m.id)) as MatchFull;
      const outcome: Outcome = { winners: [winner], ranking: [winner, seat], reason };
      const updated = await this.prisma.$transaction(async (tx) => {
        await this.finish(tx, fresh, outcome);
        return tx.match.findUniqueOrThrow({ where: { id: m.id }, include: matchInclude });
      });
      this.publish(updated, null, null, null);
      return;
    }

    if (m.game.hasBots && active.length > 1) {
      await this.prisma.matchPlayer.updateMany({ where: { matchId: m.id, seat }, data: { isBot: true, botLevel: 'MEDIUM' } });
      const updated = (await this.load(m.id)) as MatchFull;
      this.publish(updated, null, null, null);
      this.scheduleBot(m.id);
      return;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.match.update({
        where: { id: m.id },
        data: { status: 'ABANDONED', finishedAt: new Date(), endReason: 'abandoned', currentSeat: null, turnDeadline: null },
      });
      if (m.roomId) await tx.room.update({ where: { id: m.roomId }, data: { status: 'FINISHED', closedAt: new Date() } });
      return tx.match.findUniqueOrThrow({ where: { id: m.id }, include: matchInclude });
    });
    this.publish(updated, null, null, null);
  }

  private async sweepTimeouts() {
    try {
      if (!(await this.redis.set('rt:sweep:lock', '1', 'PX', 900, 'NX'))) return;
      const due = await this.prisma.match.findMany({
        where: { status: 'IN_PROGRESS', turnDeadline: { lt: new Date() } },
        select: { id: true },
        take: 50,
      });
      for (const { id } of due) await this.handleTimeout(id).catch((e) => this.log.warn(`Таймаут ${id}: ${(e as Error).message}`));
    } catch (e) {
      this.log.error('Ошибка проверки таймаутов', e as Error);
    }
  }

  private async handleTimeout(matchId: string) {
    await this.withLock(matchId, async () => {
      const m = await this.load(matchId);
      // Пока ждали блокировку, ход мог быть сделан — перепроверяем.
      if (!m || m.status !== 'IN_PROGRESS' || !m.turnDeadline || m.turnDeadline > new Date()) return;
      const game = getGame(m.game.slug);
      const seat = game.currentSeats(m.state)[0];
      if (seat === undefined) return;
      const player = m.players.find((p) => p.seat === seat);
      if (player?.isBot) return this.runBot(m);
      const auto = game.timeoutAction?.(m.state, seat) ?? null;
      if (auto !== null) {
        await this.step(m, seat, auto);
      } else {
        await this.leaveSeat(m, seat, 'timeout');
      }
    });
  }

  // ───────── боты ─────────

  private scheduleBot(matchId: string) {
    const [min, max] = BOT_DELAY_MS;
    const t = setTimeout(
      () => void this.withLock(matchId, async () => {
        const m = await this.load(matchId);
        if (m) await this.runBot(m);
      }).catch((e) => this.log.warn(`Бот ${matchId}: ${(e as Error).message}`)),
      min + Math.random() * (max - min),
    );
    t.unref();
  }

  private async runBot(m: MatchFull) {
    if (m.status !== 'IN_PROGRESS') return;
    const game = getGame(m.game.slug);
    const seats = game.currentSeats(m.state);
    const bot = m.players.find((p) => p.isBot && seats.includes(p.seat));
    if (!bot) return;
    const rngSeed = `${m.seed}:${m.stateVersion}`;
    let action = game.chooseBotAction?.(m.state, bot.seat, { level: bot.botLevel ?? 'MEDIUM', rngSeed });
    if (action === undefined) {
      // Для игры нет стратегии — случайный допустимый ход, чтобы партия не зависла.
      const legal = game.legalActions(m.state, bot.seat);
      if (legal.length === 0) return;
      action = legal[Math.floor(Math.random() * legal.length)];
    }
    await this.step(m, bot.seat, action);
  }
}
