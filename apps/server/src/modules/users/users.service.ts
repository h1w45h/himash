import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { usernameSchema } from '@nastolki/shared';
import { PrismaService } from '../../common/prisma.module';

export const updateProfileSchema = z
  .object({
    username: usernameSchema,
    displayName: z.string().trim().min(1).max(48),
    bio: z.string().max(280).nullable(),
    avatarUrl: z.string().url().nullable(),
    country: z.string().length(2).nullable(),
  })
  .partial();
export type UpdateProfileDto = z.infer<typeof updateProfileSchema>;

export const updateSettingsSchema = z
  .object({
    theme: z.enum(['SYSTEM', 'LIGHT', 'DARK']),
    soundEnabled: z.boolean(),
    hapticsEnabled: z.boolean(),
    pushEnabled: z.boolean(),
    pushFriendInvite: z.boolean(),
    pushYourTurn: z.boolean(),
    pushTournament: z.boolean(),
    allowInvitesFrom: z.enum(['EVERYONE', 'FRIENDS', 'NOBODY']),
    showOnlineStatus: z.boolean(),
  })
  .partial();

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  me(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { settings: true, wallet: { select: { coins: true, gems: true } } },
    });
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    try {
      return await this.prisma.user.update({ where: { id: userId }, data: dto });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException('Этот ник уже занят');
      throw e;
    }
  }

  updateSettings(userId: string, dto: z.infer<typeof updateSettingsSchema>) {
    return this.prisma.userSettings.update({ where: { userId }, data: dto });
  }

  /** Публичный профиль: без email и приватных настроек. */
  async publicProfile(id: string) {
    const u = await this.prisma.user.findFirst({
      where: { id, status: 'ACTIVE' },
      select: {
        id: true, username: true, displayName: true, avatarUrl: true, bio: true, country: true,
        createdAt: true, lastSeenAt: true,
        ratings: { include: { game: { select: { slug: true, title: true } } } },
        achievements: { where: { unlockedAt: { not: null } }, include: { achievement: true } },
      },
    });
    if (!u) throw new NotFoundException('Игрок не найден');
    return u;
  }

  search(query: string, selfId: string) {
    return this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        id: { not: selfId },
        username: { contains: query.toLowerCase(), mode: 'insensitive' },
        blocksMade: { none: { blockedId: selfId } },
      },
      select: { id: true, username: true, displayName: true, avatarUrl: true },
      take: 20,
    });
  }

  async registerDevice(userId: string, pushToken: string, platform: 'IOS' | 'ANDROID') {
    // Токен принадлежит устройству: при смене аккаунта переносим его на нового пользователя.
    await this.prisma.device.upsert({
      where: { pushToken },
      create: { userId, pushToken, platform },
      update: { userId, platform, lastUsed: new Date() },
    });
  }
}
