import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { getGame } from '@nastolki/game-engine';
import type { BotLevel, GameMode, Prisma } from '@prisma/client';

export interface MatchSeat {
  seat: number;
  userId: string | null;
  isBot: boolean;
  botLevel: BotLevel | null;
}

/** Создание партии. Ходы, таймеры и завершение добавляются в реал-тайм слое (шаг 5). */
@Injectable()
export class MatchesService {
  /**
   * Создаёт Match внутри переданной транзакции, чтобы старт комнаты и партия были атомарны.
   * Начальное состояние строит движок игры; сид сохраняется — партия воспроизводима.
   */
  async createInTx(
    tx: Prisma.TransactionClient,
    p: {
      roomId: string | null;
      gameId: string;
      slug: string;
      mode: GameMode;
      variantKey: string | null;
      isRated: boolean;
      turnTimeSec: number | null;
      seats: MatchSeat[];
    },
  ) {
    const game = getGame(p.slug);
    const seed = randomUUID();
    const state = game.setup({ players: p.seats.length, seed, variant: p.variantKey ?? undefined });
    const first = game.currentSeats(state)[0] ?? 0;

    return tx.match.create({
      data: {
        roomId: p.roomId,
        gameId: p.gameId,
        mode: p.mode,
        variantKey: p.variantKey,
        isRated: p.isRated,
        seed,
        state: state as Prisma.InputJsonValue,
        currentSeat: first,
        turnDeadline: p.turnTimeSec ? new Date(Date.now() + p.turnTimeSec * 1000) : null,
        players: { create: p.seats },
      },
    });
  }
}
