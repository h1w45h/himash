import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerGame, type GameDefinition } from '@nastolki/game-engine';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma.module';
import { MatchmakingService } from '../matchmaking/matchmaking.service';
import { RoomsService } from './rooms.service';

/** Интеграционный тест: нужен Postgres с применёнными миграциями и seed, плюс Redis. */
const enabled = !!process.env.DATABASE_URL && !!process.env.REDIS_URL;

// Минимальная игра-заглушка, чтобы проверить комнаты независимо от реальных движков.
const dummy: GameDefinition<{ n: number }, 'pass'> = {
  slug: 'chess', minPlayers: 2, maxPlayers: 2,
  setup: () => ({ n: 0 }),
  legalActions: () => ['pass'],
  validate: () => ({ ok: true, value: undefined }),
  apply: (s) => ({ n: s.n + 1 }),
  currentSeats: () => [0],
  outcome: () => null,
  view: (s) => s,
};

describe.skipIf(!enabled)('комнаты и матчмейкинг (интеграция)', () => {
  let prisma: PrismaService;
  let rooms: RoomsService;
  let mm: MatchmakingService;
  let close: () => Promise<void>;
  const ids: string[] = [];

  const mkUser = async (name: string) => {
    const u = await prisma.user.create({
      data: { clerkId: `test_${name}_${Date.now()}`, username: `${name}${Date.now() % 100000}`, displayName: name, settings: { create: {} } },
    });
    ids.push(u.id);
    return u.id;
  };

  beforeAll(async () => {
    try { registerGame(dummy); } catch { /* уже зарегистрирована */ }
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = mod.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    rooms = app.get(RoomsService);
    mm = app.get(MatchmakingService);
    close = () => app.close();
  });

  afterAll(async () => {
    await prisma.match.deleteMany({ where: { players: { some: { userId: { in: ids } } } } });
    await prisma.room.deleteMany({ where: { hostId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await close();
  });

  it('создание, вход по коду, готовность, старт', async () => {
    const [a, b, c] = [await mkUser('anna'), await mkUser('boris'), await mkUser('clara')];
    const room = await rooms.create(a, { gameSlug: 'chess', maxPlayers: 2, visibility: 'PUBLIC', isRated: true });
    expect(room.code).toMatch(/^[A-Z2-9]{6}$/);

    expect((await rooms.listPublic('chess')).some((r) => r.code === room.code)).toBe(true);

    await expect(rooms.start(a, room.code)).rejects.toThrow('минимум');
    const joined = await rooms.join(b, room.code.toLowerCase());
    expect(joined.players).toHaveLength(2);
    await expect(rooms.join(c, room.code)).rejects.toThrow('заполнена');

    await rooms.setReady(b, room.code, false);
    await expect(rooms.start(a, room.code)).rejects.toThrow('готовы');
    await rooms.setReady(b, room.code, true);
    await expect(rooms.start(b, room.code)).rejects.toThrow('хозяин');

    const started = await rooms.start(a, room.code);
    expect(started.status).toBe('IN_PROGRESS');
    expect(started.matchId).toBeTruthy();
    await expect(rooms.start(a, room.code)).rejects.toThrow();
  });

  it('пароль и передача прав хозяина', async () => {
    const [a, b] = [await mkUser('dina'), await mkUser('egor')];
    const room = await rooms.create(a, { gameSlug: 'chess', maxPlayers: 2, visibility: 'PRIVATE', isRated: false, password: 'секрет' });
    expect(room.hasPassword).toBe(true);
    await expect(rooms.join(b, room.code, 'не тот')).rejects.toThrow('пароль');
    await rooms.join(b, room.code, 'секрет');
    await rooms.leave(a, room.code);
    const after = await rooms.get(room.code);
    expect(after.hostId).toBe(b);
  });

  it('матчмейкинг сводит двух игроков', async () => {
    const [a, b] = [await mkUser('fedor'), await mkUser('galina')];
    await mm.join(a, { gameSlug: 'chess' });
    expect((await mm.status(a)).state).toBe('searching');
    await mm.join(b, { gameSlug: 'chess' });

    let sa = await mm.status(a);
    for (let i = 0; i < 30 && sa.state !== 'found'; i++) {
      await new Promise((r) => setTimeout(r, 200));
      sa = await mm.status(a);
    }
    expect(sa.state).toBe('found');
    const sb = await mm.status(b);
    expect(sb.state).toBe('found');
    if (sa.state === 'found' && sb.state === 'found') expect(sa.matchId).toBe(sb.matchId);
  });
});
