import { Prisma, PrismaClient } from '@prisma/client';
import { CATALOG } from '@nastolki/shared';

const prisma = new PrismaClient();

/**
 * Идемпотентный seed каталога: upsert по slug.
 * Поле status НЕ перезаписываем у существующих игр — его меняют релизы, а не seed.
 */
async function main() {
  for (const [i, g] of CATALOG.entries()) {
    const { variants, status, ...rest } = g;
    const data = { ...rest, variants: variants as Prisma.InputJsonValue | undefined, sortOrder: i };
    await prisma.game.upsert({
      where: { slug: g.slug },
      create: { ...data, status },
      update: data,
    });
  }
  console.log(`Каталог: загружено игр — ${CATALOG.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
