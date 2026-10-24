import { Prisma, PrismaClient } from '@prisma/client';
import { CATALOG } from '@nastolki/shared';

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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
