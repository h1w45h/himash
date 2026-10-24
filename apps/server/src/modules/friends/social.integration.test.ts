import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerGame } from '@nastolki/game-engine';
import type { Ack, ChatMessageDto, PresenceUpdate } from '@nastolki/shared';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma.module';
import { countingGame, countingGameRow } from '../../testing/counting-game';
import { AuthService } from '../auth/auth.service';
import { PushSender, type PushMessage } from '../notifications/push.sender';
import { RoomsService } from '../rooms/rooms.service';
import { FriendsService } from './friends.service';

const enabled = !!process.env.DATABASE_URL && !!process.env.REDIS_URL;

const emit = <T>(s: Socket, ev: string, body: unknown) => s.emitWithAck(ev, body) as Promise<Ack<T>>;
const once = <T>(s: Socket, ev: string, ms = 4000) =>
  new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error(`Таймаут ожидания «${ev}»`)), ms);
    s.once(ev, (d: T) => { clearTimeout(t); res(d); });
  });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class FakePush extends PushSender {
  sent: PushMessage[] = [];
  async send(m: PushMessage[]) { this.sent.push(...m); return []; }
}

describe.skipIf(!enabled)('социальные функции (интеграция)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let friends: FriendsService;
  let rooms: RoomsService;
  let url: string;
  const push = new FakePush();
  const ids: string[] = [];
  const sockets: Socket[] = [];

  const mkUser = async (name: string) => {
    const clerkId = `soc_${name}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const u = await prisma.user.create({
      data: { clerkId, username: `${name}${Math.floor(Math.random() * 1e6)}`, displayName: name, settings: { create: {} }, wallet: { create: { coins: 0 } } },
    });
    ids.push(u.id);
    return { id: u.id, token: clerkId, username: u.username };
  };
  const connect = async (token: string) => {
    const s = io(`${url}/game`, { auth: { token }, transports: ['websocket'], reconnection: false });
    sockets.push(s);
    await once(s, 'connect');
    return s;
  };
  const befriend = async (a: string, b: string) => {
    const f = await friends.request(a, { userId: b });
    await friends.accept(b, f.id);
  };
  const addDevice = (userId: string, n: string) =>
    prisma.device.create({ data: { userId, platform: 'IOS', pushToken: `ExponentPushToken[${n}${Date.now()}${Math.random()}]` } });

  beforeAll(async () => {
    registerGame(countingGame);
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthService)
      .useFactory({ factory: (p: PrismaService) => ({ authenticate: (t: string) => p.user.findUniqueOrThrow({ where: { clerkId: t } }) }), inject: [PrismaService] })
      .overrideProvider(PushSender)
      .useValue(push)
      .compile();
    app = mod.createNestApplication();
    await app.listen(0);
    url = await app.getUrl().then((u) => u.replace('[::1]', 'localhost'));
    prisma = app.get(PrismaService);
    friends = app.get(FriendsService);
    rooms = app.get(RoomsService);
    await prisma.game.upsert({ where: { slug: countingGameRow.slug }, create: countingGameRow, update: countingGameRow });
  });

  afterAll(async () => {
    sockets.forEach((s) => s.close());
    await prisma.chatMessage.deleteMany({ where: { OR: [{ senderId: { in: ids } }, { recipientId: { in: ids } }] } });
    await prisma.match.deleteMany({ where: { players: { some: { userId: { in: ids } } } } });
    await prisma.room.deleteMany({ where: { hostId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.game.deleteMany({ where: { slug: countingGameRow.slug } });
    await app.close();
  });

  it('заявка → push офлайн-получателю → принятие → список друзей', async () => {
    const [a, b] = [await mkUser('alla'), await mkUser('boris')];
    await addDevice(b.id, 'b');
    const before = push.sent.length;
    const f = await friends.request(a.id, { username: b.username });
    expect(push.sent.length).toBe(before + 1);
    expect(push.sent.at(-1)).toMatchObject({ title: 'Новая заявка в друзья' });
    await expect(friends.request(a.id, { userId: b.id })).rejects.toThrow('уже отправлена');

    expect((await friends.list(b.id)).incoming).toHaveLength(1);
    await friends.accept(b.id, f.id);
    const la = await friends.list(a.id);
    expect(la.friends.map((x) => x.user.id)).toEqual([b.id]);
    expect(la.friends[0]!.status).toBe('offline');
    await expect(friends.request(a.id, { userId: b.id })).rejects.toThrow('друзья');
  });

  it('встречная заявка = согласие; отклонённую можно подать заново', async () => {
    const [a, b, c] = [await mkUser('vera'), await mkUser('gleb'), await mkUser('dina')];
    await friends.request(a.id, { userId: b.id });
    await friends.request(b.id, { userId: a.id });
    expect((await friends.list(a.id)).friends).toHaveLength(1);

    const f = await friends.request(a.id, { userId: c.id });
    await friends.decline(c.id, f.id);
    expect((await friends.list(c.id)).incoming).toHaveLength(0);
    await friends.request(a.id, { userId: c.id });
    expect((await friends.list(c.id)).incoming).toHaveLength(1);
  });

  it('push не уходит онлайн-пользователю и при выключенных уведомлениях', async () => {
    const [a, b, c] = [await mkUser('egor'), await mkUser('zina'), await mkUser('igor')];
    await addDevice(b.id, 'z');
    await addDevice(c.id, 'i');
    const sb = await connect(b.token);
    await sleep(100);
    let n = push.sent.length;
    await friends.request(a.id, { userId: b.id });
    expect(push.sent.length).toBe(n); // b онлайн — в приложении увидит сам
    sb.close();
    await sleep(300);

    await prisma.userSettings.update({ where: { userId: c.id }, data: { pushFriendInvite: false } });
    n = push.sent.length;
    await friends.request(a.id, { userId: c.id });
    expect(push.sent.length).toBe(n);
    expect(await prisma.notification.count({ where: { userId: c.id, type: 'FRIEND_REQUEST' } })).toBe(1); // в центре уведомлений запись есть
  });

  it('присутствие: друг получает presence:update, статус виден в списке', async () => {
    const [a, b] = [await mkUser('kira'), await mkUser('lev')];
    await befriend(a.id, b.id);
    const sa = await connect(a.token);
    const upd = once<PresenceUpdate>(sa, 'presence:update');
    const sb = await connect(b.token);
    expect(await upd).toEqual({ userId: b.id, status: 'online' });
    expect((await friends.list(a.id)).friends[0]!.status).toBe('online');

    const off = once<PresenceUpdate>(sa, 'presence:update');
    sb.close();
    expect(await off).toEqual({ userId: b.id, status: 'offline' });

    // скрытый статус всегда «offline»
    await prisma.userSettings.update({ where: { userId: b.id }, data: { showOnlineStatus: false } });
    const sb2 = await connect(b.token);
    await sleep(150);
    expect((await friends.list(a.id)).friends[0]!.status).toBe('offline');
    sb2.close();
  });

  it('личные сообщения: только друзьям, доставка обоим, счётчик непрочитанных', async () => {
    const [a, b, x] = [await mkUser('mila'), await mkUser('nikita'), await mkUser('oleg')];
    await befriend(a.id, b.id);
    const [sa, sb, sx] = [await connect(a.token), await connect(b.token), await connect(x.token)];

    expect(await emit(sx, 'chat:send', { scope: 'DIRECT', target: a.id, body: 'привет' })).toMatchObject({ ok: false, code: 'FORBIDDEN' });

    const got = once<ChatMessageDto>(sb, 'chat:message');
    const echo = once<ChatMessageDto>(sa, 'chat:message');
    expect(await emit(sa, 'chat:send', { scope: 'DIRECT', target: b.id, body: 'Сыграем?' })).toMatchObject({ ok: true });
    expect((await got).body).toBe('Сыграем?');
    expect((await echo).recipientId).toBe(b.id);

    expect((await friends.list(b.id)).friends[0]!.unread).toBe(1);
    const chat = app.get((await import('../chat/chat.service')).ChatService);
    const history = await chat.history(b.id, 'DIRECT', a.id);
    expect(history.map((m) => m.body)).toEqual(['Сыграем?']);
    await chat.markRead(b.id, a.id);
    expect((await friends.list(b.id)).friends[0]!.unread).toBe(0);
  });

  it('блокировка разрывает дружбу и запрещает заявки', async () => {
    const [a, b] = [await mkUser('pavel'), await mkUser('rita')];
    await befriend(a.id, b.id);
    await friends.block(a.id, b.id);
    expect((await friends.list(a.id)).friends).toHaveLength(0);
    await expect(friends.request(b.id, { userId: a.id })).rejects.toThrow();
    await friends.unblock(a.id, b.id);
    await friends.request(b.id, { userId: a.id });
  });

  it('push «Ваш ход» офлайн-сопернику — не чаще раза за 5 минут', async () => {
    const [a, b] = [await mkUser('sasha'), await mkUser('tanya')];
    await addDevice(b.id, 't');
    const room = await rooms.create(a.id, { gameSlug: 'test-counting', maxPlayers: 2, visibility: 'PRIVATE', isRated: false });
    await rooms.join(b.id, room.code);
    await rooms.setReady(b.id, room.code, true);
    const started = await rooms.start(a.id, room.code);
    const sa = await connect(a.token);
    await emit(sa, 'match:resync', { matchId: started.matchId });
    const n = push.sent.length;
    await emit(sa, 'match:action', { matchId: started.matchId, expectedVersion: 0, action: { add: 1 } });
    await sleep(200);
    const turnPushes = push.sent.slice(n).filter((m) => m.title === 'Ваш ход');
    expect(turnPushes).toHaveLength(1);
  });
});
