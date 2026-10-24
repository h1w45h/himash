import { Injectable, NotFoundException } from '@nestjs/common';
import type { GameCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.module';

export interface GameFilters {
  category?: GameCategory;
  players?: number;
  q?: string;
}

// В списке правила не отдаём — они тяжёлые и нужны только на карточке игры.
const listSelect = {
  id: true, slug: true, title: true, tagline: true, description: true, category: true,
  minPlayers: true, maxPlayers: true, avgMinutes: true, complexity: true, coverUrl: true, iconUrl: true,
  hasBots: true, supportsLocal: true, supportsOnline: true, isRated: true, variants: true, status: true,
} satisfies Prisma.GameSelect;

@Injectable()
export class GamesService {
  constructor(private readonly prisma: PrismaService) {}

  list(f: GameFilters) {
    const where: Prisma.GameWhereInput = {};
    if (f.category) where.category = f.category;
    if (f.players) {
      where.minPlayers = { lte: f.players };
      where.maxPlayers = { gte: f.players };
    }
    if (f.q) {
      where.OR = [
        { title: { contains: f.q, mode: 'insensitive' } },
        { tagline: { contains: f.q, mode: 'insensitive' } },
      ];
    }
    return this.prisma.game.findMany({ where, select: listSelect, orderBy: { sortOrder: 'asc' } });
  }

  async get(slug: string) {
    const game = await this.prisma.game.findUnique({ where: { slug } });
    if (!game) throw new NotFoundException('Игра не найдена');
    return game;
  }

  /** Лидерборд игры: топ по рейтингу (только игроки с хотя бы одной партией). */
  leaderboard(slug: string, limit = 20) {
    return this.prisma.rating.findMany({
      where: { game: { slug }, wins: { gt: 0 } },
      orderBy: { rating: 'desc' },
      take: Math.min(limit, 100),
      select: {
        rating: true, wins: true, losses: true, draws: true,
        user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      },
    });
  }
}
