import { Controller, ForbiddenException, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { RealtimeError } from '@nastolki/shared';
import { PrismaService } from '../../common/prisma.module';
import { userBrief } from '../../common/social';
import { CurrentUser } from '../auth/auth.decorators';
import type { AuthUser } from '../auth/auth.types';
import { MatchRuntime } from './match-runtime.service';

@Controller('matches')
export class MatchesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: MatchRuntime,
  ) {}

  /** История партий игрока (курсорная пагинация по id). */
  @Get('mine')
  async mine(@CurrentUser() u: AuthUser, @Query('cursor') cursor?: string, @Query('game') game?: string) {
    const rows = await this.prisma.matchPlayer.findMany({
      where: { userId: u.id, match: { status: { not: 'IN_PROGRESS' }, ...(game ? { game: { slug: game } } : {}) } },
      orderBy: { match: { finishedAt: 'desc' } },
      take: 21,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        match: {
          select: {
            id: true, mode: true, finishedAt: true, isRated: true, game: { select: { slug: true, title: true } },
            players: { select: { seat: true, result: true, isBot: true, user: { select: userBrief } } },
          },
        },
      },
    });
    const items = rows.slice(0, 20).map((r) => ({
      matchPlayerId: r.id, seat: r.seat, result: r.result, ratingDelta: r.ratingDelta, ...r.match,
    }));
    return { items, nextCursor: rows.length > 20 ? (rows[19]?.id ?? null) : null };
  }

  /** Текущая незавершённая партия — для кнопки «Продолжить» на главной. */
  @Get('active')
  async active(@CurrentUser() u: AuthUser) {
    const mp = await this.prisma.matchPlayer.findFirst({
      where: { userId: u.id, result: null, match: { status: 'IN_PROGRESS' } },
      select: { match: { select: { id: true, game: { select: { slug: true, title: true } } } } },
    });
    return mp?.match ?? null;
  }

  @Get(':id')
  async get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    try {
      return await this.runtime.snapshotFor(u.id, id);
    } catch (e) {
      if (e instanceof RealtimeError) {
        throw e.code === 'NOT_FOUND' ? new NotFoundException(e.message) : new ForbiddenException(e.message);
      }
      throw e;
    }
  }

  /** Журнал ходов для реплея — только участникам и только после окончания (иначе раскроем скрытую информацию). */
  @Get(':id/moves')
  async moves(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const m = await this.prisma.match.findUnique({
      where: { id },
      select: { status: true, seed: true, variantKey: true, game: { select: { slug: true } }, players: { select: { userId: true } } },
    });
    if (!m) throw new NotFoundException('Партия не найдена');
    if (!m.players.some((p) => p.userId === u.id)) throw new ForbiddenException('Нет доступа');
    if (m.status === 'IN_PROGRESS') throw new ForbiddenException('Реплей доступен после окончания партии');
    const moves = await this.prisma.matchMove.findMany({ where: { matchId: id }, orderBy: { index: 'asc' }, select: { index: true, seat: true, action: true } });
    return { gameSlug: m.game.slug, seed: m.seed, variantKey: m.variantKey, players: m.players.length, moves };
  }
}
