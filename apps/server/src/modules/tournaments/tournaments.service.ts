import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException,
  OnModuleDestroy, OnModuleInit,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import { hasGame } from '@nastolki/game-engine';
import type { Prisma } from '@prisma/client';
import type { Subscription } from 'rxjs';
import { DomainEvents } from '../../common/events.module';
import { PrismaService } from '../../common/prisma.module';
import { userBrief } from '../../common/social';
import { NotificationsService } from '../notifications/notifications.service';
import { RoomsService } from '../rooms/rooms.service';
import { firstRound, nextOf, nextPow2, placementForLoser, roundsCount, splitPrize } from './bracket';

export interface CreateTournamentDto {
  gameSlug: string;
  title: string;
  description?: string;
  maxPlayers: 4 | 8 | 16 | 32;
  entryFee: number;
  isPrivate: boolean;
  startsAt: Date;
}

const MOVE_TIMEOUT_SEC = 120; // на ход в турнирной партии — просрочка = поражение (так отсеиваются неявившиеся)
const MAX_DRAWS = 2; // после двух ничьих проходит сеяный выше
const FREE_PRIZE = { first: 200, second: 100 }; // призы бесплатных турниров выдаёт «банк»
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

@Injectable()
export class TournamentsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(TournamentsService.name);
  private ticker?: NodeJS.Timeout;
  private sub?: Subscription;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly events: DomainEvents,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.sub = this.events.stream.subscribe((e) => {
      if (e.type === 'match.finished') void this.onMatchFinished(e.matchId).catch((err) => this.log.error(err as Error));
    });
    this.ticker = setInterval(() => void this.autoStart().catch((e) => this.log.error(e as Error)), 15_000);
    this.ticker.unref();
  }
  onModuleDestroy() {
    this.sub?.unsubscribe();
    if (this.ticker) clearInterval(this.ticker);
  }

  // ───────── создание, список, чтение ─────────

  async create(userId: string, dto: CreateTournamentDto) {
    const game = await this.prisma.game.findUnique({ where: { slug: dto.gameSlug } });
    if (!game || !hasGame(game.slug)) throw new BadRequestException('Для этой игры турниры пока недоступны');
    if (game.minPlayers !== 2 || game.maxPlayers !== 2) throw new BadRequestException('Турниры доступны для игр на двоих (шахматы, шашки)');
    if (dto.startsAt.getTime() < Date.now() + 60_000) throw new BadRequestException('Начало турнира должно быть минимум через минуту');
    if (dto.startsAt.getTime() > Date.now() + 30 * 24 * 3600_000) throw new BadRequestException('Турнир нельзя назначить дальше чем на 30 дней');
    for (let i = 0; i < 5; i++) {
      try {
        return await this.prisma.tournament.create({
          data: {
            gameId: game.id, creatorId: userId, title: dto.title, description: dto.description, format: 'SINGLE_ELIMINATION',
            isPrivate: dto.isPrivate, joinCode: dto.isPrivate ? this.code() : null, maxPlayers: dto.maxPlayers, minPlayers: 2,
            entryFee: dto.entryFee, startsAt: dto.startsAt,
          },
        });
      } catch (e) {
        if ((e as { code?: string }).code !== 'P2002') throw e;
      }
    }
    throw new ConflictException('Не удалось создать турнир');
  }

  private code() {
    return Array.from({ length: 6 }, () => JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)]).join('');
  }

  async list(userId: string, scope: 'open' | 'mine' | 'finished') {
    const where: Prisma.TournamentWhereInput =
      scope === 'open' ? { status: 'REGISTRATION', isPrivate: false }
      : scope === 'mine' ? { participants: { some: { userId } }, status: { in: ['REGISTRATION', 'IN_PROGRESS'] } }
      : { status: 'FINISHED', OR: [{ isPrivate: false }, { participants: { some: { userId } } }] };
    const rows = await this.prisma.tournament.findMany({
      where, take: 50, orderBy: scope === 'finished' ? { finishedAt: 'desc' } : { startsAt: 'asc' },
      include: { game: { select: { slug: true, title: true } }, creator: { select: userBrief }, _count: { select: { participants: true } } },
    });
    return rows.map(({ joinCode: _c, ...t }) => ({ ...t, participants: t._count.participants }));
  }

  async byCode(code: string) {
    const t = await this.prisma.tournament.findUnique({ where: { joinCode: code.trim().toUpperCase() }, select: { id: true } });
    if (!t) throw new NotFoundException('Турнир с таким кодом не найден');
    return t;
  }

  async get(userId: string, id: string) {
    const t = await this.prisma.tournament.findUnique({
      where: { id },
      include: {
        game: { select: { slug: true, title: true } },
        creator: { select: userBrief },
        participants: { include: { user: { select: userBrief } }, orderBy: [{ placement: 'asc' }, { seed: 'asc' }, { joinedAt: 'asc' }] },
        matches: { orderBy: [{ round: 'asc' }, { position: 'asc' }] },
      },
    });
    if (!t) throw new NotFoundException('Турнир не найден');
    const isMember = t.participants.some((p) => p.userId === userId) || t.creatorId === userId;
    if (t.isPrivate && !isMember) throw new ForbiddenException('Закрытый турнир: нужен код приглашения');
    const users = new Map(t.participants.map((p) => [p.userId, p.user]));
    const { joinCode, ...rest } = t;
    return {
      ...rest,
      joinCode: t.creatorId === userId ? joinCode : null, // код видит только организатор
      size: nextPow2(Math.max(t.participants.length, 2)),
      matches: t.matches.map((m) => ({ ...m, players: m.playerIds.map((id) => users.get(id) ?? null) })),
      myMatch: t.matches.find((m) => m.matchId && !m.winnerId && m.playerIds.includes(userId))?.matchId ?? null,
    };
  }

  // ───────── регистрация ─────────

  private lock(tx: Prisma.TransactionClient, id: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
  }

  async join(userId: string, id: string, code?: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, id);
      const t = await tx.tournament.findUnique({ where: { id }, include: { _count: { select: { participants: true } } } });
      if (!t) throw new NotFoundException('Турнир не найден');
      if (t.status !== 'REGISTRATION') throw new ConflictException('Регистрация закрыта');
      if (t.isPrivate && t.creatorId !== userId && t.joinCode !== code?.trim().toUpperCase()) throw new ForbiddenException('Неверный код приглашения');
      if (t._count.participants >= t.maxPlayers) throw new ConflictException('Мест больше нет');
      if (await tx.tournamentParticipant.findUnique({ where: { tournamentId_userId: { tournamentId: id, userId } } })) throw new ConflictException('Вы уже участвуете');
      if (t.entryFee > 0) {
        const paid = await tx.wallet.updateMany({ where: { userId, coins: { gte: t.entryFee } }, data: { coins: { decrement: t.entryFee } } });
        if (paid.count === 0) throw new BadRequestException(`Для участия нужно ${t.entryFee} монет`);
        await tx.walletTransaction.create({
          data: { userId, currency: 'COINS', amount: -t.entryFee, reason: 'TOURNAMENT_FEE', refId: id, idempotencyKey: `tfee:${id}:${userId}:${Date.now()}` },
        });
      }
      await tx.tournamentParticipant.create({ data: { tournamentId: id, userId } });
    });
    return { ok: true };
  }

  private async refund(tx: Prisma.TransactionClient, t: { id: string; entryFee: number }, userId: string) {
    if (t.entryFee <= 0) return;
    await tx.wallet.update({ where: { userId }, data: { coins: { increment: t.entryFee } } });
    await tx.walletTransaction.create({
      data: { userId, currency: 'COINS', amount: t.entryFee, reason: 'TOURNAMENT_FEE', refId: t.id, idempotencyKey: `tfeer:${t.id}:${userId}:${Date.now()}` },
    });
  }

  async leave(userId: string, id: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, id);
      const t = await tx.tournament.findUnique({ where: { id } });
      if (!t) throw new NotFoundException('Турнир не найден');
      if (t.status !== 'REGISTRATION') throw new ConflictException('Турнир уже идёт — выйти нельзя');
      const del = await tx.tournamentParticipant.deleteMany({ where: { tournamentId: id, userId } });
      if (del.count === 0) throw new NotFoundException('Вы не участвуете');
      await this.refund(tx, t, userId);
    });
    return { ok: true };
  }

  async cancel(userId: string, id: string) {
    const t = await this.prisma.tournament.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Турнир не найден');
    if (t.creatorId !== userId) throw new ForbiddenException('Только организатор может отменить турнир');
    if (t.status !== 'REGISTRATION') throw new ConflictException('Турнир уже идёт');
    await this.cancelAndRefund(id);
    return { ok: true };
  }

  private async cancelAndRefund(id: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, id);
      const t = await tx.tournament.findUnique({ where: { id }, include: { participants: true } });
      if (!t || t.status !== 'REGISTRATION') return;
      await tx.tournament.update({ where: { id }, data: { status: 'CANCELLED', finishedAt: new Date() } });
      for (const p of t.participants) await this.refund(tx, t, p.userId);
    });
  }

  // ───────── старт и сетка ─────────

  async start(userId: string, id: string) {
    const t = await this.prisma.tournament.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Турнир не найден');
    if (t.creatorId !== userId) throw new ForbiddenException('Только организатор может начать турнир');
    await this.startTournament(id);
    return { ok: true };
  }

  private async autoStart() {
    const due = await this.prisma.tournament.findMany({
      where: { status: 'REGISTRATION', startsAt: { lte: new Date() } },
      include: { _count: { select: { participants: true } } },
    });
    for (const t of due) {
      if (t._count.participants >= t.minPlayers) await this.startTournament(t.id).catch((e) => this.log.warn(`старт ${t.id}: ${(e as Error).message}`));
      else await this.cancelAndRefund(t.id); // не набралось игроков — возвращаем взносы
    }
  }

  private async startTournament(id: string) {
    const launch: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, id);
      const t = await tx.tournament.findUnique({ where: { id }, include: { participants: true } });
      if (!t) throw new NotFoundException('Турнир не найден');
      if (t.status !== 'REGISTRATION') throw new ConflictException('Турнир уже начат');
      if (t.participants.length < t.minPlayers) throw new BadRequestException(`Нужно минимум ${t.minPlayers} участника`);

      // Сеяние по рейтингу в этой игре; при равенстве — случайно.
      const ratings = await tx.rating.findMany({ where: { gameId: t.gameId, userId: { in: t.participants.map((p) => p.userId) } } });
      const rating = new Map(ratings.map((r) => [r.userId, r.rating]));
      const seeded = t.participants
        .map((p) => ({ userId: p.userId, r: rating.get(p.userId) ?? 1200, tie: Math.random() }))
        .sort((a, b) => b.r - a.r || a.tie - b.tie);
      for (const [i, p] of seeded.entries()) {
        await tx.tournamentParticipant.update({ where: { tournamentId_userId: { tournamentId: id, userId: p.userId } }, data: { seed: i + 1 } });
      }

      const size = nextPow2(seeded.length);
      const rounds = roundsCount(size);
      const rows: { id: string; round: number; position: number }[] = [];
      for (let r = 1; r <= rounds; r++) {
        for (let pos = 0; pos < size / 2 ** r; pos++) {
          const m = await tx.tournamentMatch.create({ data: { tournamentId: id, round: r, position: pos, playerIds: [] } });
          rows.push({ id: m.id, round: r, position: pos });
        }
      }
      const byKey = new Map(rows.map((m) => [`${m.round}:${m.position}`, m.id]));
      for (const m of rows) {
        const nx = nextOf(m.round, m.position);
        const nextId = byKey.get(`${nx.round}:${nx.position}`);
        if (nextId) await tx.tournamentMatch.update({ where: { id: m.id }, data: { nextMatchId: nextId } });
      }
      // Первый раунд: пары по сетке; одиночки (проход) сразу продвигаются.
      for (const [pos, slot] of firstRound(seeded.length).entries()) {
        const a = slot.a === null ? null : seeded[slot.a]!.userId;
        const b = slot.b === null ? null : seeded[slot.b]!.userId;
        await tx.tournamentMatch.update({ where: { id: byKey.get(`1:${pos}`)! }, data: { playerIds: [a, b].filter((x): x is string => !!x) } });
      }
      await tx.tournament.update({ where: { id }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });
    });

    // Проходы и запуск готовых матчей — вне транзакции создания сетки.
    const matches = await this.prisma.tournamentMatch.findMany({ where: { tournamentId: id, round: 1 } });
    for (const m of matches) {
      if (m.playerIds.length === 1) await this.advance(m.id, m.playerIds[0] as string, true);
      else launch.push(m.id);
    }
    for (const mid of launch) await this.launch(mid);
  }

  /** Создаёт партию для матча сетки, когда известны оба соперника. */
  private async launch(tmId: string, swap = false) {
    const tm = await this.prisma.tournamentMatch.findUnique({ where: { id: tmId }, include: { tournament: { include: { game: true } } } });
    if (!tm || tm.winnerId || tm.matchId || tm.playerIds.length !== 2) return;
    const players = swap ? [...tm.playerIds].reverse() : tm.playerIds;
    const room = await this.rooms.createMatched(tm.tournament.game.slug, null, players, { mode: 'TOURNAMENT', turnTimeSec: MOVE_TIMEOUT_SEC });
    await this.prisma.tournamentMatch.update({ where: { id: tmId }, data: { matchId: room.matchId } });
    this.events.emit({ type: 'tournament.match', userIds: players, matchId: room.matchId as string, tournamentId: tm.tournamentId });
    for (const userId of players) {
      await this.notifications.notify(userId, {
        type: 'TOURNAMENT_START',
        title: `Турнир «${tm.tournament.title}»`,
        body: `Раунд ${tm.round}: ваша партия началась. Первый ход нужно сделать в течение ${MOVE_TIMEOUT_SEC} с.`,
        data: { tournamentId: tm.tournamentId, matchId: room.matchId as string },
      });
    }
  }

  // ───────── результаты ─────────

  private async onMatchFinished(matchId: string) {
    const tm = await this.prisma.tournamentMatch.findUnique({ where: { matchId }, include: { match: { include: { players: true } } } });
    if (!tm || tm.winnerId || !tm.match) return;
    const winnerSeat = tm.match.winnerSeats[0];
    const winner = winnerSeat === undefined ? null : tm.match.players.find((p) => p.seat === winnerSeat)?.userId;
    if (winner) return this.advance(tm.id, winner);

    // Ничья: переигровка с обменом цветами, после MAX_DRAWS проходит сеяный выше.
    if (tm.attempts <= MAX_DRAWS) {
      await this.prisma.tournamentMatch.update({ where: { id: tm.id }, data: { attempts: { increment: 1 }, matchId: null } });
      return this.launch(tm.id, tm.attempts % 2 === 1);
    }
    const seeds = await this.prisma.tournamentParticipant.findMany({ where: { tournamentId: tm.tournamentId, userId: { in: tm.playerIds } } });
    const top = seeds.sort((a, b) => (a.seed ?? 99) - (b.seed ?? 99))[0]?.userId ?? tm.playerIds[0]!;
    return this.advance(tm.id, top);
  }

  /** Фиксирует победителя матча и двигает его дальше; финал завершает турнир. */
  private async advance(tmId: string, winnerId: string, bye = false) {
    const tm = await this.prisma.tournamentMatch.findUniqueOrThrow({ where: { id: tmId }, include: { tournament: true } });
    const t = tm.tournament;
    const loser = tm.playerIds.find((p) => p !== winnerId);
    const size = nextPow2(await this.prisma.tournamentParticipant.count({ where: { tournamentId: t.id } }));

    const next = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.tournamentMatch.updateMany({ where: { id: tmId, winnerId: null }, data: { winnerId } });
      if (claimed.count === 0) return undefined; // уже обработан
      if (loser && !bye) {
        await tx.tournamentParticipant.update({
          where: { tournamentId_userId: { tournamentId: t.id, userId: loser } },
          data: { eliminated: true, placement: placementForLoser(size, tm.round) },
        });
      }
      if (!tm.nextMatchId) return null; // финал
      const nxt = await tx.tournamentMatch.findUniqueOrThrow({ where: { id: tm.nextMatchId } });
      const slot = tm.position % 2;
      const ids = [...nxt.playerIds];
      ids[slot] = winnerId;
      await tx.tournamentMatch.update({ where: { id: nxt.id }, data: { playerIds: ids.filter((x): x is string => !!x) } });
      return { id: nxt.id, ready: ids.filter(Boolean).length === 2 };
    });

    if (next === undefined) return;
    if (next === null) return this.finishTournament(t.id, winnerId);
    if (next.ready) await this.launch(next.id);
  }

  private async finishTournament(id: string, winnerId: string) {
    await this.prisma.$transaction(async (tx) => {
      const t = await tx.tournament.findUniqueOrThrow({ where: { id }, include: { participants: true } });
      if (t.status === 'FINISHED') return;
      await tx.tournamentParticipant.update({ where: { tournamentId_userId: { tournamentId: id, userId: winnerId } }, data: { placement: 1 } });
      await tx.tournament.update({ where: { id }, data: { status: 'FINISHED', finishedAt: new Date() } });

      const pool = t.entryFee * t.participants.length;
      const finalist = (await tx.tournamentParticipant.findMany({ where: { tournamentId: id, placement: 2 } }))[0];
      const semis = t.participants.filter((p) => p.placement === 3);
      const prizes = new Map<string, number>();
      if (pool > 0) {
        const split = splitPrize(pool, semis.length);
        prizes.set(winnerId, split.first);
        if (finalist) prizes.set(finalist.userId, split.second);
        for (const s of semis) prizes.set(s.userId, split.semi);
      } else {
        prizes.set(winnerId, FREE_PRIZE.first);
        if (finalist) prizes.set(finalist.userId, FREE_PRIZE.second);
      }
      for (const [userId, coins] of prizes) {
        if (coins <= 0) continue;
        await tx.wallet.upsert({ where: { userId }, create: { userId, coins }, update: { coins: { increment: coins } } });
        await tx.walletTransaction.create({
          data: { userId, currency: 'COINS', amount: coins, reason: 'TOURNAMENT_PRIZE', refId: id, idempotencyKey: `tprize:${id}:${userId}` },
        });
      }
    });
    const t = await this.prisma.tournament.findUniqueOrThrow({ where: { id }, include: { participants: true } });
    for (const p of t.participants) {
      await this.notifications.notify(p.userId, {
        type: 'TOURNAMENT_START',
        title: `Турнир «${t.title}» завершён`,
        body: p.placement === 1 ? 'Вы победили! 🏆' : `Ваше место: ${p.placement ?? '—'}`,
        data: { tournamentId: id },
      });
    }
  }
}
