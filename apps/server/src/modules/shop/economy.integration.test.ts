import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerGame } from '@nastolki/game-engine';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma.module';
import { countingGame, countingGameRow } from '../../testing/counting-game';
import { AchievementsService } from '../achievements/achievements.service';
import { MatchRuntime } from '../matches/match-runtime.service';
import { RoomsService } from '../rooms/rooms.service';
import { PushSender } from '../notifications/push.sender';
import { ShopService } from './shop.service';
import { WalletService } from './wallet.service';

const enabled = !!process.env.DATABASE_URL && !!process.env.REDIS_URL;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!enabled)('экономика: кошелёк, магазин, достижения (интеграция)', () => {
  let prisma: PrismaService;
  let wallet: WalletService;
  let shop: ShopService;
  let rooms: RoomsService;
  let runtime: MatchRuntime;
  let achievements: AchievementsService;
  let close: () => Promise<void>;
  const ids: string[] = [];

  const mkUser = async (name: string, coins = 0) => {
    const u = await prisma.user.create({
      data: { clerkId: `eco_${name}_${Date.now()}_${Math.random()}`, username: `${name}${Math.floor(Math.random() * 1e6)}`, displayName: name, settings: { create: {} }, wallet: { create: { coins } } },
    });
    ids.push(u.id);
    return u.id;
  };
  const coins = async (id: string) => (await prisma.wallet.findUniqueOrThrow({ where: { userId: id } })).coins;

  beforeAll(async () => {
    try { registerGame(countingGame); } catch { /* уже есть */ }
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PushSender).useValue({ send: async () => [] })
      .compile();
    const app = mod.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    wallet = app.get(WalletService);
    shop = app.get(ShopService);
    rooms = app.get(RoomsService);
    runtime = app.get(MatchRuntime);
    achievements = app.get(AchievementsService);
    close = () => app.close();
    await prisma.game.upsert({ where: { slug: countingGameRow.slug }, create: countingGameRow, update: countingGameRow });
  });

  afterAll(async () => {
    await prisma.match.deleteMany({ where: { players: { some: { userId: { in: ids } } } } });
    await prisma.room.deleteMany({ where: { hostId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.game.deleteMany({ where: { slug: countingGameRow.slug } });
    await close();
  });

  it('ежедневный бонус: серия растёт, пропуск дня сбрасывает, дважды в день нельзя', async () => {
    const u = await mkUser('daily');
    const d1 = new Date('2030-01-10T10:00:00Z');
    expect((await wallet.get(u, d1)).daily).toMatchObject({ available: true, streak: 0, nextBonus: 20 });
    expect(await wallet.claimDaily(u, d1)).toEqual({ amount: 20, streak: 1 });
    await expect(wallet.claimDaily(u, new Date('2030-01-10T20:00:00Z'))).rejects.toThrow('уже получен');
    expect(await wallet.claimDaily(u, new Date('2030-01-11T10:00:00Z'))).toEqual({ amount: 30, streak: 2 });
    // пропустили 12-е → серия начинается заново
    expect(await wallet.claimDaily(u, new Date('2030-01-13T10:00:00Z'))).toEqual({ amount: 20, streak: 1 });
    expect(await coins(u)).toBe(70);
    // гонка: два параллельных запроса — начисление одно
    const v = await mkUser('dailyrace');
    const r = await Promise.allSettled([wallet.claimDaily(v, d1), wallet.claimDaily(v, d1)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await coins(v)).toBe(20);
  });

  it('магазин: покупка, нехватка монет, повтор, гонка, экипировка', async () => {
    const poor = await mkUser('poor', 50);
    const rich = await mkUser('rich', 1000);
    const fox = await prisma.shopItem.findUniqueOrThrow({ where: { sku: 'avatar_fox' } });
    const green = await prisma.shopItem.findUniqueOrThrow({ where: { sku: 'board_green' } });

    await expect(shop.buy(poor, fox.id)).rejects.toThrow('Недостаточно монет');
    expect(await coins(poor)).toBe(50);

    await shop.buy(rich, fox.id);
    expect(await coins(rich)).toBe(900);
    await expect(shop.buy(rich, fox.id)).rejects.toThrow('Уже куплено');
    expect(await coins(rich)).toBe(900);

    // денег хватает только на одну покупку из двух параллельных
    const half = await mkUser('half', 300);
    const res = await Promise.allSettled([shop.buy(half, green.id), shop.buy(half, green.id)]);
    expect(res.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await coins(half)).toBe(0);

    await expect(shop.equip(poor, fox.id)).rejects.toThrow('Сначала купите');
    await shop.equip(rich, fox.id);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: rich } })).avatarId).toBe('avatar:fox');
    await shop.equip(half, green.id);
    expect((await prisma.userSettings.findUniqueOrThrow({ where: { userId: half } })).activeBoardTheme).toBe('board:green');

    const list = await shop.list(rich);
    expect(list.find((i) => i.sku === 'avatar_fox')).toMatchObject({ owned: true, equipped: true });
    expect(list.find((i) => i.sku === 'avatar_cat')).toMatchObject({ owned: false, equipped: false });
    await shop.unequip(rich, 'AVATAR');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: rich } })).avatarId).toBeNull();
  });

  it('достижения: первая победа выдаётся один раз с наградой и уведомлением', async () => {
    const [a, b] = [await mkUser('winner'), await mkUser('loser')];
    const room = await rooms.create(a, { gameSlug: 'test-counting', maxPlayers: 2, visibility: 'PRIVATE', isRated: false });
    await rooms.join(b, room.code);
    await rooms.setReady(b, room.code, true);
    const started = await rooms.start(a, room.code);
    await runtime.resign(b, started.matchId as string); // победа Анны

    let unlocked = false;
    for (let i = 0; i < 30 && !unlocked; i++) {
      await sleep(100);
      unlocked = !!(await prisma.userAchievement.findFirst({ where: { userId: a, achievement: { key: 'first_win' }, unlockedAt: { not: null } } }));
    }
    expect(unlocked).toBe(true);
    // 30 за партию с двумя живыми игроками + 50 за достижение
    expect(await coins(a)).toBe(80);
    expect(await prisma.notification.count({ where: { userId: a, type: 'ACHIEVEMENT' } })).toBeGreaterThanOrEqual(1);
    expect(await prisma.userAchievement.count({ where: { userId: b, unlockedAt: { not: null } } })).toBe(0);

    expect(await achievements.evaluate(a)).toEqual([]); // повторный подсчёт ничего не выдаёт
    expect(await coins(a)).toBe(80);

    const list = await achievements.list(a);
    expect(list[0]).toMatchObject({ key: 'first_win' });
    expect(list.find((x) => x.key === 'wins_10')).toMatchObject({ progress: 1, target: 10, unlockedAt: null });
  });
});
