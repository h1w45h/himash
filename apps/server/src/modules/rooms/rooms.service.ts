import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException,
  OnModuleDestroy, OnModuleInit,
} from '@nestjs/common';
import type { BotLevel, Prisma, Room } from '@prisma/client';
import { hasGame } from '@nastolki/game-engine';
import { normalizeRoomCode, type CreateRoomDto } from '@nastolki/shared';
import { DomainEvents } from '../../common/events.module';
import { PrismaService } from '../../common/prisma.module';
import { hashPassword, verifyPassword } from '../../common/security';
import { areFriends, isBlockedBetween, userBrief } from '../../common/social';
import { MatchesService } from '../matches/matches.service';
import { firstFreeSeat, generateRoomCode } from './room-logic';

const roomInclude = {
  game: { select: { slug: true, title: true } },
  host: { select: userBrief },
  players: { include: { user: { select: userBrief } }, orderBy: { seat: 'asc' } },
  match: { select: { id: true } },
} satisfies Prisma.RoomInclude;

type RoomFull = Prisma.RoomGetPayload<{ include: typeof roomInclude }>;

const ACTIVE = ['WAITING', 'STARTING', 'IN_PROGRESS'] as const;
const STALE_ROOM_MS = 60 * 60_000;

/** Представление комнаты для клиента: хеш пароля никогда не отдаётся. */
export function roomView(r: RoomFull) {
  const { passwordHash, match, ...rest } = r;
  return { ...rest, hasPassword: !!passwordHash, matchId: match?.id ?? null };
}
export type RoomView = ReturnType<typeof roomView>;

@Injectable()
export class RoomsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(RoomsService.name);
  private cleanup?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
    private readonly matches: MatchesService,
  ) {}

  onModuleInit() {
    // Закрываем «забытые» комнаты ожидания, чтобы они не засоряли список.
    this.cleanup = setInterval(() => void this.closeStale().catch((e) => this.log.error(e)), 60_000);
    this.cleanup.unref();
  }
  onModuleDestroy() {
    if (this.cleanup) clearInterval(this.cleanup);
  }

  private async closeStale() {
    const rooms = await this.prisma.room.findMany({
      where: { status: 'WAITING', createdAt: { lt: new Date(Date.now() - STALE_ROOM_MS) } },
      select: { id: true, code: true },
    });
    for (const r of rooms) await this.close(r.id, r.code);
  }

  private async close(roomId: string, code: string) {
    await this.prisma.room.update({ where: { id: roomId }, data: { status: 'CLOSED', closedAt: new Date() } });
    this.events.emit({ type: 'room.closed', roomId, code });
  }

  // ───────── чтение ─────────

  private async load(code: string): Promise<RoomFull> {
    const room = await this.prisma.room.findUnique({ where: { code: normalizeRoomCode(code) }, include: roomInclude });
    if (!room || room.status === 'CLOSED') throw new NotFoundException('Комната не найдена');
    return room;
  }

  async get(code: string) {
    return roomView(await this.load(code));
  }

  async listPublic(gameSlug?: string) {
    const rooms = await this.prisma.room.findMany({
      where: { status: 'WAITING', visibility: 'PUBLIC', mode: 'ONLINE', ...(gameSlug ? { game: { slug: gameSlug } } : {}) },
      include: roomInclude,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rooms.filter((r) => r.players.length < r.maxPlayers).map(roomView);
  }

  async mine(userId: string) {
    const rp = await this.prisma.roomPlayer.findFirst({
      where: { userId, room: { status: { in: [...ACTIVE] } } },
      include: { room: { include: roomInclude } },
    });
    return rp ? roomView(rp.room) : null;
  }

  // ───────── создание и вход ─────────

  /**
   * Пользователь может быть только в одной активной комнате.
   * Ожидающую комнату покидаем автоматически, идущая партия — конфликт.
   */
  async assertFree(userId: string) {
    const rp = await this.prisma.roomPlayer.findFirst({
      where: { userId, room: { status: { in: [...ACTIVE] } } },
      include: { room: true },
    });
    if (!rp) return;
    if (rp.room.status !== 'WAITING') throw new ConflictException('Вы уже участвуете в партии');
    await this.removePlayer(rp.room, rp.seat);
  }

  async create(userId: string, dto: CreateRoomDto) {
    const game = await this.prisma.game.findUnique({ where: { slug: dto.gameSlug } });
    if (!game) throw new NotFoundException('Игра не найдена');
    if (!game.supportsOnline) throw new BadRequestException('Эта игра не поддерживает онлайн-режим');
    if (!hasGame(game.slug)) throw new BadRequestException('Игра пока недоступна для партий');
    if (dto.maxPlayers < game.minPlayers || dto.maxPlayers > game.maxPlayers) {
      throw new BadRequestException(`Число игроков: от ${game.minPlayers} до ${game.maxPlayers}`);
    }
    const variants = (game.variants as { key: string }[] | null) ?? [];
    if (dto.variantKey && !variants.some((v) => v.key === dto.variantKey)) {
      throw new BadRequestException('Неизвестный вариант игры');
    }
    await this.assertFree(userId);

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const room = await this.prisma.room.create({
          data: {
            code: generateRoomCode(),
            gameId: game.id,
            hostId: userId,
            visibility: dto.visibility,
            maxPlayers: dto.maxPlayers,
            minPlayers: game.minPlayers,
            isRated: dto.isRated && game.isRated,
            turnTimeSec: dto.turnTimeSec,
            variantKey: dto.variantKey,
            passwordHash: dto.password ? hashPassword(dto.password) : null,
            players: { create: { userId, seat: 0, isReady: true } }, // хозяин всегда готов
          },
          include: roomInclude,
        });
        return roomView(room);
      } catch (e) {
        if ((e as { code?: string }).code !== 'P2002') throw e; // коллизия кода — пробуем другой
      }
    }
    throw new ConflictException('Не удалось создать комнату, попробуйте ещё раз');
  }

  async join(userId: string, code: string, password?: string, bypassChecks = false) {
    const room = await this.load(code);
    if (room.players.some((p) => p.userId === userId)) return roomView(room);
    if (room.status !== 'WAITING') throw new ConflictException('Партия уже началась');

    if (!bypassChecks) {
      if (room.passwordHash && !(password && verifyPassword(password, room.passwordHash))) {
        throw new ForbiddenException('Неверный пароль комнаты');
      }
      if (room.visibility === 'FRIENDS' && !(await areFriends(this.prisma, userId, room.hostId))) {
        throw new ForbiddenException('Комната только для друзей хозяина');
      }
    }
    if (await isBlockedBetween(this.prisma, userId, room.hostId)) {
      throw new ForbiddenException('Вход в эту комнату недоступен');
    }
    await this.assertFree(userId);

    // Уникальность (roomId, seat) защищает от гонки при одновременном входе: повторяем с новым местом.
    for (let attempt = 0; attempt < 4; attempt++) {
      const players = await this.prisma.roomPlayer.findMany({ where: { roomId: room.id }, select: { seat: true } });
      const seat = firstFreeSeat(players.map((p) => p.seat), room.maxPlayers);
      if (seat === null) throw new ConflictException('Комната заполнена');
      try {
        await this.prisma.roomPlayer.create({ data: { roomId: room.id, userId, seat } });
        return this.touch(room.code);
      } catch (e) {
        if ((e as { code?: string }).code !== 'P2002') throw e;
      }
    }
    throw new ConflictException('Не удалось занять место, попробуйте ещё раз');
  }

  /** Перечитывает комнату, публикует событие обновления и возвращает представление. */
  private async touch(code: string) {
    const room = await this.load(code);
    this.events.emit({ type: 'room.updated', roomId: room.id, code: room.code });
    return roomView(room);
  }

  // ───────── выход, готовность, боты ─────────

  async leave(userId: string, code: string) {
    const room = await this.load(code);
    const me = room.players.find((p) => p.userId === userId);
    if (!me) throw new NotFoundException('Вы не в этой комнате');
    if (room.status !== 'WAITING') throw new ConflictException('Партия идёт — сдайтесь в самой партии');
    await this.removePlayer(room, me.seat);
    return { ok: true };
  }

  private async removePlayer(room: Pick<Room, 'id' | 'code' | 'hostId'>, seat: number) {
    await this.prisma.roomPlayer.deleteMany({ where: { roomId: room.id, seat } });
    const humans = await this.prisma.roomPlayer.findMany({
      where: { roomId: room.id, userId: { not: null } },
      orderBy: { joinedAt: 'asc' },
    });
    if (humans.length === 0) return this.close(room.id, room.code);
    // Хозяин вышел — права переходят к тому, кто вошёл раньше всех.
    if (!humans.some((h) => h.userId === room.hostId)) {
      const next = humans[0];
      if (next?.userId) {
        await this.prisma.room.update({ where: { id: room.id }, data: { hostId: next.userId } });
        await this.prisma.roomPlayer.update({ where: { id: next.id }, data: { isReady: true } });
      }
    }
    this.events.emit({ type: 'room.updated', roomId: room.id, code: room.code });
  }

  async setReady(userId: string, code: string, ready: boolean) {
    const room = await this.load(code);
    if (room.status !== 'WAITING') throw new ConflictException('Партия уже началась');
    const me = room.players.find((p) => p.userId === userId);
    if (!me) throw new NotFoundException('Вы не в этой комнате');
    if (room.hostId === userId) return roomView(room); // хозяин всегда готов
    await this.prisma.roomPlayer.update({ where: { id: me.id }, data: { isReady: ready } });
    return this.touch(code);
  }

  private async requireHost(userId: string, code: string): Promise<RoomFull> {
    const room = await this.load(code);
    if (room.hostId !== userId) throw new ForbiddenException('Только хозяин комнаты может это сделать');
    if (room.status !== 'WAITING') throw new ConflictException('Партия уже началась');
    return room;
  }

  async addBot(userId: string, code: string, level: BotLevel) {
    const room = await this.requireHost(userId, code);
    const game = await this.prisma.game.findUniqueOrThrow({ where: { id: room.gameId } });
    if (!game.hasBots) throw new BadRequestException('Для этой игры боты недоступны');
    const seat = firstFreeSeat(room.players.map((p) => p.seat), room.maxPlayers);
    if (seat === null) throw new ConflictException('Комната заполнена');
    await this.prisma.roomPlayer.create({ data: { roomId: room.id, seat, isBot: true, botLevel: level, isReady: true } });
    return this.touch(code);
  }

  async kick(userId: string, code: string, seat: number) {
    const room = await this.requireHost(userId, code);
    const target = room.players.find((p) => p.seat === seat);
    if (!target) throw new NotFoundException('Место свободно');
    if (target.userId === userId) throw new BadRequestException('Нельзя выгнать себя — выйдите из комнаты');
    await this.prisma.roomPlayer.delete({ where: { id: target.id } });
    return this.touch(code);
  }

  // ───────── старт ─────────

  async start(userId: string, code: string) {
    const room = await this.requireHost(userId, code);
    return this.startRoom(room);
  }

  private async startRoom(room: RoomFull) {
    if (room.players.length < room.minPlayers) {
      throw new BadRequestException(`Нужно минимум игроков: ${room.minPlayers}`);
    }
    if (room.players.some((p) => !p.isReady)) throw new BadRequestException('Не все игроки готовы');

    // Статус меняем условным апдейтом: двойной «Старт» не создаст две партии.
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.room.updateMany({
        where: { id: room.id, status: 'WAITING' },
        data: { status: 'IN_PROGRESS', startedAt: new Date() },
      });
      if (claimed.count === 0) throw new ConflictException('Партия уже запускается');
      await this.matches.createInTx(tx, {
        roomId: room.id,
        gameId: room.gameId,
        slug: room.game.slug,
        mode: 'ONLINE',
        variantKey: room.variantKey,
        isRated: room.isRated,
        turnTimeSec: room.turnTimeSec,
        seats: room.players.map((p) => ({ seat: p.seat, userId: p.userId, isBot: p.isBot, botLevel: p.botLevel })),
      });
    });

    const started = await this.load(room.code);
    const userIds = started.players.flatMap((p) => (p.userId ? [p.userId] : []));
    if (started.match) this.events.emit({ type: 'match.started', roomId: room.id, matchId: started.match.id, userIds });
    this.events.emit({ type: 'room.updated', roomId: room.id, code: room.code });
    return roomView(started);
  }

  /** Для матчмейкинга: закрытая комната из найденных игроков, партия стартует сразу. */
  async createMatched(gameSlug: string, variantKey: string | null, userIds: string[]) {
    const game = await this.prisma.game.findUniqueOrThrow({ where: { slug: gameSlug } });
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const room = await this.prisma.room.create({
          data: {
            code: generateRoomCode(),
            gameId: game.id,
            hostId: userIds[0] as string,
            visibility: 'PRIVATE',
            maxPlayers: userIds.length,
            minPlayers: userIds.length,
            isRated: game.isRated,
            variantKey,
            players: { create: userIds.map((id, seat) => ({ userId: id, seat, isReady: true })) },
          },
          include: roomInclude,
        });
        return this.startRoom(room);
      } catch (e) {
        if ((e as { code?: string }).code !== 'P2002') throw e;
      }
    }
    throw new ConflictException('Не удалось создать комнату');
  }
}
