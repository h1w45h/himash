import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerBuiltinGames, registerGame } from '@nastolki/game-engine';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma.module';
import { countingGame, countingGameRow } from '../../testing/counting-game';
import { MatchRuntime } from '../matches/match-runtime.service';
import { PushSender } from '../notifications/push.sender';
import { TournamentsService } from './tournaments.service';

const enabled = !!process.env.DATABASE_URL && !!process.env.REDIS_URL;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!enabled)('турниры (интеграция)', () => {
  let prisma: PrismaService;
  let svc: TournamentsService;
  let runtime: MatchRuntime;
  let close: () => Promise<void>;
  const ids: string[] = [];
  const soon = () => new Date(Date.now() + 5 * 60_000);

  const mkUser = async (name: string, coins = 500) => {
    const u = await prisma.user.create({
      data: { clerkId: `trn_${name}_${Date.now()}_${Math.random()}`, username: `${name}${Math.floor(Math.random() * 1e6)}`, displayName: name, settings: { create: {} }, wallet: { create: { coins } } },
    });
    ids.push(u.id);
    return u.id;
  };
  /** Баланс без наград за достижения (они зависят от истории и не относятся к турниру). */
  const coins = async (id: string) => {
    const w = await prisma.wallet.findUniqueOrThrow({ where: { userId: id } });
    const ach = await prisma.walletTransaction.aggregate({ where: { userId: id, reason: 'ACHIEVEMENT' }, _sum: { amount: true } });
    return w.coins - (ach._sum.amount ?? 0);
  };
  const waitFor = async <T>(fn: () => Promise<T | null | undefined | false>, ms = 4000): Promise<T> => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const v = await fn();
      if (v) return v;
      await sleep(80);
    }
    throw new Error('не дождались условия');
  };
  /** Проигрывает матч сеткой: `loser` сдаётся. */
  const playMatch = async (tmId: string, loser: string) => {
    const tm = await waitFor(() => prisma.tournamentMatch.findUnique({ where: { id: tmId } }).then((m) => (m?.matchId ? m : null)));
    await runtime.resign(loser, tm.matchId as string);
    await waitFor(() => prisma.tournamentMatch.findUnique({ where: { id: tmId } }).then((m) => (m?.winnerId ? m : null)));
  };

  beforeAll(async () => {
    registerBuiltinGames();
    try { registerGame(countingGame); } catch { /* уже есть */ }
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PushSender).useValue({ send: async () => [] }).compile();
    const app = mod.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    svc = app.get(TournamentsService);
    runtime = app.get(MatchRuntime);
    close = () => app.close();
    await prisma.game.upsert({ where: { slug: countingGameRow.slug }, create: countingGameRow, update: countingGameRow });
  });

  afterAll(async () => {
    await prisma.tournament.deleteMany({ where: { creatorId: { in: ids } } });
    await prisma.match.deleteMany({ where: { players: { some: { userId: { in: ids } } } } });
    await prisma.room.deleteMany({ where: { hostId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.game.deleteMany({ where: { slug: countingGameRow.slug } });
    await close();
  });

  it('регистрация: взнос, возврат при выходе, код приватного турнира, лимит мест', async () => {
    const [org, a, b, c] = [await mkUser('org'), await mkUser('a'), await mkUser('b'), await mkUser('c', 10)];
    const t = await svc.create(org, { gameSlug: 'test-counting', title: 'Закрытый кубок', maxPlayers: 4, entryFee: 100, isPrivate: true, startsAt: soon() });
    expect(t.joinCode).toMatch(/^[A-Z2-9]{6}$/);

    await expect(svc.join(a, t.id)).rejects.toThrow('код');
    await svc.join(a, t.id, t.joinCode!.toLowerCase());
    expect(await coins(a)).toBe(400);
    await svc.leave(a, t.id);
    expect(await coins(a)).toBe(500);
    await expect(svc.join(c, t.id, t.joinCode!)).rejects.toThrow('нужно 100 монет');
    await svc.join(a, t.id, t.joinCode!);
    await expect(svc.join(a, t.id, t.joinCode!)).rejects.toThrow('уже участвуете');
    await svc.join(b, t.id, t.joinCode!);

    // чужой не видит закрытый турнир, организатор видит код
    await expect(svc.get(c, t.id)).rejects.toThrow('Закрытый');
    expect((await svc.get(org, t.id)).joinCode).toBe(t.joinCode);
    expect((await svc.get(a, t.id)).joinCode).toBeNull();

    await svc.cancel(org, t.id);
    expect(await coins(a)).toBe(500);
    expect(await coins(b)).toBe(500);
  });

  it('полный турнир на 4: сетка, партии, продвижение, призы из взносов', async () => {
    const [org, p1, p2, p3, p4] = [await mkUser('o2'), await mkUser('p1'), await mkUser('p2'), await mkUser('p3'), await mkUser('p4')];
    const t = await svc.create(org, { gameSlug: 'test-counting', title: 'Кубок', maxPlayers: 4, entryFee: 100, isPrivate: false, startsAt: soon() });
    for (const p of [p1, p2, p3, p4]) await svc.join(p, t.id);
    await expect(svc.start(p1, t.id)).rejects.toThrow('организатор');
    await svc.start(org, t.id);

    const matches = await prisma.tournamentMatch.findMany({ where: { tournamentId: t.id }, orderBy: [{ round: 'asc' }, { position: 'asc' }] });
    expect(matches).toHaveLength(3);
    const [m1, m2, fin] = matches;
    expect(m1!.playerIds).toHaveLength(2);
    expect(new Set([...m1!.playerIds, ...m2!.playerIds]).size).toBe(4);
    expect(m1!.nextMatchId).toBe(fin!.id);

    // Полуфиналы: во втором слоте каждой пары — проигравший (сдаётся)
    const loser1 = m1!.playerIds[1]!;
    const loser2 = m2!.playerIds[1]!;
    await playMatch(m1!.id, loser1);
    await playMatch(m2!.id, loser2);
    const final = await waitFor(() => prisma.tournamentMatch.findUnique({ where: { id: fin!.id } }).then((m) => (m?.matchId ? m : null)));
    expect(final.playerIds.sort()).toEqual([m1!.playerIds[0]!, m2!.playerIds[0]!].sort());

    const champion = final.playerIds[0]!;
    const runnerUp = final.playerIds[1]!;
    await playMatch(fin!.id, runnerUp);
    const done = await waitFor(() => prisma.tournament.findUnique({ where: { id: t.id } }).then((x) => (x?.status === 'FINISHED' ? x : null)));
    expect(done.status).toBe('FINISHED');

    const parts = await prisma.tournamentParticipant.findMany({ where: { tournamentId: t.id } });
    const place = (u: string) => parts.find((p) => p.userId === u)?.placement;
    expect([place(champion), place(runnerUp), place(loser1), place(loser2)]).toEqual([1, 2, 3, 3]);

    // Взносов 400: 1-й — 240, 2-й — 100, полуфиналисты по 30. Плюс 30 за каждую победу в партии (сдавшийся не получает).
    expect(await coins(champion)).toBe(500 - 100 + 30 + 30 + 240);
    expect(await coins(runnerUp)).toBe(500 - 100 + 30 + 100);
    expect(await coins(loser1)).toBe(500 - 100 + 30);
    expect(await coins(loser2)).toBe(500 - 100 + 30);
  });

  it('нечётное число участников: сильнейший получает проход', async () => {
    const [org, a, b, c] = [await mkUser('o3'), await mkUser('x1'), await mkUser('x2'), await mkUser('x3')];
    const t = await svc.create(org, { gameSlug: 'test-counting', title: 'Малый кубок', maxPlayers: 4, entryFee: 0, isPrivate: false, startsAt: soon() });
    for (const p of [a, b, c]) await svc.join(p, t.id);
    await svc.start(org, t.id);

    const matches = await prisma.tournamentMatch.findMany({ where: { tournamentId: t.id }, orderBy: [{ round: 'asc' }, { position: 'asc' }] });
    const byeMatch = matches.find((m) => m.round === 1 && m.winnerId)!;
    expect(byeMatch).toBeTruthy();
    const seed1 = (await prisma.tournamentParticipant.findFirstOrThrow({ where: { tournamentId: t.id, seed: 1 } })).userId;
    expect(byeMatch.winnerId).toBe(seed1);
    expect((await prisma.tournamentParticipant.findFirstOrThrow({ where: { tournamentId: t.id, seed: 1 } })).eliminated).toBe(false);

    const real = matches.find((m) => m.round === 1 && !m.winnerId)!;
    await playMatch(real.id, real.playerIds[1]!);
    const final = matches.find((m) => m.round === 2)!;
    const fm = await waitFor(() => prisma.tournamentMatch.findUnique({ where: { id: final.id } }).then((m) => (m?.matchId ? m : null)));
    await playMatch(final.id, fm.playerIds[0]!);
    const winner = (await prisma.tournamentMatch.findUniqueOrThrow({ where: { id: final.id } })).winnerId!;
    await waitFor(() => prisma.tournament.findUnique({ where: { id: t.id } }).then((x) => (x?.status === 'FINISHED' ? x : null)));
    // бесплатный турнир: приз из «банка» 200 победителю
    expect(await coins(winner)).toBeGreaterThanOrEqual(500 + 200);
  });

  it('автоотмена по времени: не набралось игроков → взносы возвращены', async () => {
    const [org, a] = [await mkUser('o4'), await mkUser('y1')];
    const t = await svc.create(org, { gameSlug: 'test-counting', title: 'Пустой кубок', maxPlayers: 8, entryFee: 50, isPrivate: false, startsAt: soon() });
    await svc.join(a, t.id);
    expect(await coins(a)).toBe(450);
    await prisma.tournament.update({ where: { id: t.id }, data: { startsAt: new Date(Date.now() - 1000), minPlayers: 2 } });
    await (svc as unknown as { autoStart(): Promise<void> }).autoStart();
    expect((await prisma.tournament.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('CANCELLED');
    expect(await coins(a)).toBe(500);
  });

  it('валидация создания', async () => {
    const org = await mkUser('o5');
    await expect(svc.create(org, { gameSlug: 'monopoly', title: 'Монополия', maxPlayers: 4, entryFee: 0, isPrivate: false, startsAt: soon() })).rejects.toThrow('на двоих');
    await expect(svc.create(org, { gameSlug: 'test-counting', title: 'Скоро', maxPlayers: 4, entryFee: 0, isPrivate: false, startsAt: new Date() })).rejects.toThrow('через минуту');
  });
});
