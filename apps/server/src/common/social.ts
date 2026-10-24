import type { PrismaService } from './prisma.module';

export const userBrief = { id: true, username: true, displayName: true, avatarUrl: true } as const;

export async function areFriends(prisma: PrismaService, a: string, b: string): Promise<boolean> {
  const f = await prisma.friendship.findFirst({
    where: {
      status: 'ACCEPTED',
      OR: [
        { requesterId: a, addresseeId: b },
        { requesterId: b, addresseeId: a },
      ],
    },
    select: { id: true },
  });
  return !!f;
}

/** Блокировка в любую сторону запрещает совместные комнаты и приглашения. */
export async function isBlockedBetween(prisma: PrismaService, a: string, b: string): Promise<boolean> {
  const x = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
  });
  return !!x;
}
