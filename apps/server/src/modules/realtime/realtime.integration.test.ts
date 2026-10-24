import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerGame } from '@nastolki/game-engine';
import type { Ack, MatchSnapshot, MatchUpdate } from '@nastolki/shared';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma.module';
import { countingGame } from '../../testing/counting-game';
import { AuthService } from '../auth/auth.service';
import { RoomsService } from '../rooms/rooms.service';

const enabled = !!process.env.DATABASE_URL && !!process.env.REDIS_URL;

const emit = <T>(s: Socket, ev: string, body: unknown) => s.emitWithAck(ev, body) as Promise<Ack<T>>;
const once = <T>(s: Socket, ev: string, ms = 4000) =>
  new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error(`Таймаут ожидания «${ev}»`)), ms);
    s.once(ev, (d: T) => { clearTimeout(t); res(d); });
  });

describe.skipIf(!enabled)('реал-тайм: партия через Socket.io (интеграция)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let rooms: RoomsService;
  let url: string;
  const ids: string[] = [];
  const sockets: Socket[] = [];

  const mkUser = async (name: string) => {
    const clerkId = `rt_${name}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const u = await prisma.user.create({
      data: { clerkId, username: `${name}${Math.floor(Math.random() * 1e6)}`, displayName: name, settings: { create: {} }, wallet: { create: { coins: 0 } } },
    });
    ids.push(u.id);
    return { id: u.id, token: clerkId };
  };
  const connect = async (token: string) => {
    const s = io(`${url}/game`, { auth: { token }, transports: ['websocket'], reconnection: false });
    sockets.push(s);
    await once(s, 'connect');
    return s;
  };
  const startMatch = async (a: string, b: string) => {
    const room = await rooms.create(a, { gameSlug: 'chess', maxPlayers: 2, visibility: 'PRIVATE', isRated: true });
    await rooms.join(b, room.code);
    await rooms.setReady(b, room.code, true);
    return (await rooms.start(a, room.code)).matchId as string;
  };

  beforeAll(async () => {
    try { registerGame(countingGame); } catch { /* уже есть */ }
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthService)
      .useFactory({
        factory: (p: PrismaService) => ({ authenticate: (token: string) => p.user.findUniqueOrThrow({ where: { clerkId: token } }) }),
        inject: [PrismaService],
      })
      .compile();
    app = mod.createNestApplication();
    await app.listen(0);
    url = await app.getUrl().then((u) => u.replace('[::1]', 'localhost'));
    prisma = app.get(PrismaService);
    rooms = app.get(RoomsService);
  });

  afterAll(async () => {
    sockets.forEach((s) => s.close());
    const where = { players: { some: { userId: { in: ids } } } };
    await prisma.chatMessage.deleteMany({ where: { OR: [{ senderId: { in: ids } }] } });
    await prisma.match.deleteMany({ where });
    await prisma.room.deleteMany({ where: { hostId: { in: ids } } });
    await prisma.rating.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  it('отклоняет соединение без токена', async () => {
    const s = io(`${url}/game`, { auth: {}, transports: ['websocket'], reconnection: false });
    sockets.push(s);
    await expect(once(s, 'connect_error')).resolves.toBeTruthy();
  });

  it('полная партия: ходы, STALE, чужой ход, победа, рейтинг и награда', async () => {
    const [a, b] = [await mkUser('anna'), await mkUser('boris')];
    const matchId = await startMatch(a.id, b.id);
    const [sa, sb] = [await connect(a.token), await connect(b.token)];

    const snapA = await emit<MatchSnapshot>(sa, 'match:resync', { matchId });
    const snapB = await emit<MatchSnapshot>(sb, 'match:resync', { matchId });
    expect(snapA.ok && snapA.data.seat).toBe(0);
    expect(snapB.ok && snapB.data.seat).toBe(1);

    // не ваш ход
    const early = await emit(sb, 'match:action', { matchId, expectedVersion: 0, action: { add: 1 } });
    expect(early).toMatchObject({ ok: false, code: 'INVALID' });
    // неверное действие
    expect(await emit(sa, 'match:action', { matchId, expectedVersion: 0, action: { add: 9 } })).toMatchObject({ ok: false, code: 'INVALID' });

    const updB = once<MatchUpdate>(sb, 'match:update');
    expect(await emit(sa, 'match:action', { matchId, expectedVersion: 0, action: { add: 3 } })).toMatchObject({ ok: true, data: { version: 1 } });
    const u1 = await updB;
    expect(u1.version).toBe(1);
    expect(u1.currentSeats).toEqual([1]);
    expect(u1.legal).toHaveLength(3); // у Бориса теперь ход — сервер прислал допустимые действия

    // устаревшая версия
    expect(await emit(sb, 'match:action', { matchId, expectedVersion: 0, action: { add: 1 } })).toMatchObject({ ok: false, code: 'STALE' });

    await emit(sb, 'match:action', { matchId, expectedVersion: 1, action: { add: 3 } });
    await emit(sa, 'match:action', { matchId, expectedVersion: 2, action: { add: 3 } });
    const ended = once<MatchUpdate>(sa, 'match:ended');
    await emit(sb, 'match:action', { matchId, expectedVersion: 3, action: { add: 3 } });
    const end = await ended;
    expect(end.status).toBe('FINISHED');
    expect(end.outcome?.winners).toEqual([1]);

    // после окончания ходить нельзя
    expect(await emit(sa, 'match:action', { matchId, expectedVersion: 4, action: { add: 1 } })).toMatchObject({ ok: false });

    const [ra, rb] = await Promise.all([
      prisma.rating.findFirst({ where: { userId: a.id } }),
      prisma.rating.findFirst({ where: { userId: b.id } }),
    ]);
    expect(rb!.rating).toBeGreaterThan(1200);
    expect(ra!.rating).toBeLessThan(1200);
    expect(await prisma.matchMove.count({ where: { matchId } })).toBe(4);
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: b.id } })).coins).toBe(30);
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: a.id } })).coins).toBe(10);
  });

  it('реконнект: resync возвращает актуальное состояние', async () => {
    const [a, b] = [await mkUser('vera'), await mkUser('gleb')];
    const matchId = await startMatch(a.id, b.id);
    const sa = await connect(a.token);
    await emit(sa, 'match:resync', { matchId });
    await emit(sa, 'match:action', { matchId, expectedVersion: 0, action: { add: 2 } });
    sa.close();

    const sa2 = await connect(a.token);
    const snap = await emit<MatchSnapshot>(sa2, 'match:resync', { matchId, sinceVersion: 0 });
    expect(snap.ok && snap.data.version).toBe(1);
    expect(snap.ok && (snap.data.view as { total: number }).total).toBe(2);
  });

  it('сдача отдаёт победу сопернику; чужак не может войти', async () => {
    const [a, b, x] = [await mkUser('dasha'), await mkUser('egor'), await mkUser('xenia')];
    const matchId = await startMatch(a.id, b.id);
    const [sa, sb, sx] = [await connect(a.token), await connect(b.token), await connect(x.token)];
    await emit(sb, 'match:resync', { matchId });
    expect(await emit(sx, 'match:resync', { matchId })).toMatchObject({ ok: false, code: 'FORBIDDEN' });

    const ended = once<MatchUpdate>(sb, 'match:ended');
    expect(await emit(sa, 'match:resign', { matchId })).toMatchObject({ ok: true });
    const end = await ended;
    expect(end.outcome).toMatchObject({ winners: [1], reason: 'resign' });
    expect(end.players.find((p) => p.seat === 0)?.result).toBe('LEFT');
  });

  it('чат партии доходит до соперника, лимит частоты работает', async () => {
    const [a, b] = [await mkUser('zina'), await mkUser('igor')];
    const matchId = await startMatch(a.id, b.id);
    const [sa, sb] = [await connect(a.token), await connect(b.token)];
    await emit(sa, 'match:resync', { matchId });
    await emit(sb, 'match:resync', { matchId });

    const got = once<{ body: string }>(sb, 'chat:message');
    expect(await emit(sa, 'chat:send', { scope: 'MATCH', target: matchId, body: 'Привет!' })).toMatchObject({ ok: true });
    expect((await got).body).toBe('Привет!');

    let limited: Ack<unknown> | null = null;
    for (let i = 0; i < 10 && !limited; i++) {
      const r = await emit(sa, 'chat:send', { scope: 'MATCH', target: matchId, body: `спам ${i}` });
      if (!r.ok && r.code === 'RATE_LIMIT') limited = r;
    }
    expect(limited).not.toBeNull();
  });

  it('бот делает ход сам', async () => {
    const a = await mkUser('lena');
    const room = await rooms.create(a.id, { gameSlug: 'chess', maxPlayers: 2, visibility: 'PRIVATE', isRated: true });
    await rooms.addBot(a.id, room.code, 'EASY');
    const started = await rooms.start(a.id, room.code);
    expect(started.isRated).toBe(true); // настройка комнаты не меняется…
    const matchId = started.matchId as string;
    expect((await prisma.match.findUniqueOrThrow({ where: { id: matchId } })).isRated).toBe(false); // …но партия с ботом нерейтинговая

    const sa = await connect(a.token);
    await emit(sa, 'match:resync', { matchId });
    const botMove = once<MatchUpdate>(sa, 'match:update', 6000);
    await emit(sa, 'match:action', { matchId, expectedVersion: 0, action: { add: 1 } });
    await botMove; // ответ на наш ход
    const next = await once<MatchUpdate>(sa, 'match:update', 6000);
    expect(next.version).toBe(2);
    expect(next.lastAction?.seat).toBe(1);
  });

  it('истечение таймера хода — техническое поражение', async () => {
    const [a, b] = [await mkUser('maks'), await mkUser('nina')];
    const matchId = await startMatch(a.id, b.id);
    const sb = await connect(b.token);
    await emit(sb, 'match:resync', { matchId });
    // Ход Анны (место 0) просрочен.
    await prisma.match.update({ where: { id: matchId }, data: { turnDeadline: new Date(Date.now() - 1000) } });
    const end = await once<MatchUpdate>(sb, 'match:ended', 5000);
    expect(end.outcome).toMatchObject({ winners: [1], reason: 'timeout' });
  });
});
