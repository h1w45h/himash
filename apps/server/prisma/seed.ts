import { Prisma, PrismaClient } from '@prisma/client';
import { ACHIEVEMENTS, CATALOG, SHOP } from '@nastolki/shared';

const prisma = new PrismaClient();

/**
 * Идемпотентный seed каталога: upsert по slug.
 * Статус повышаем до указанного в каталоге, если игра уже реализована (не PLANNED);
 * вручную выставленный RELEASED не понижается.
 */
async function main() {
  for (const [i, g] of CATALOG.entries()) {
    const { variants, status, ...rest } = g;
    const data = { ...rest, variants: variants as Prisma.InputJsonValue | undefined, sortOrder: i };
    const existing = await prisma.game.findUnique({ where: { slug: g.slug }, select: { status: true } });
    const keep = existing?.status === 'RELEASED' || (existing && status === 'PLANNED');
    await prisma.game.upsert({
      where: { slug: g.slug },
      create: { ...data, status },
      update: keep ? data : { ...data, status },
    });
  }
  console.log(`Каталог: загружено игр — ${CATALOG.length}`);

  const games = new Map((await prisma.game.findMany({ select: { id: true, slug: true } })).map((g) => [g.slug, g.id]));
  for (const a of ACHIEVEMENTS) {
    const data = {
      title: a.title, description: a.description, rarity: a.rarity, target: a.target, rewardCoins: a.reward,
      hidden: a.hidden ?? false, gameId: a.gameSlug ? (games.get(a.gameSlug) ?? null) : null,
    };
    await prisma.achievement.upsert({ where: { key: a.key }, create: { key: a.key, ...data }, update: data });
  }
  for (const i of SHOP) {
    const data = {
      type: i.type, title: i.title, description: i.description, assetKey: i.assetKey, gameSlug: i.gameSlug ?? null,
      currency: 'COINS' as const, price: i.price, rarity: i.rarity,
    };
    await prisma.shopItem.upsert({ where: { sku: i.sku }, create: { sku: i.sku, ...data }, update: data });
  }
  console.log(`Достижений: ${ACHIEVEMENTS.length}, предметов магазина: ${SHOP.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
