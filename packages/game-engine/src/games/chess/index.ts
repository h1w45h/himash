import { fail, ok, type GameDefinition, type Outcome, type Seat } from '../../core/types';
import { chooseMove } from './ai';
import {
  evaluateResult, initialState, inCheck, legalMoves, makeMove,
  type ChessMove, type ChessState, type Promo,
} from './board';

export * from './board';

/** Что видит клиент: ключи повторений не нужны, шах считаем заранее. */
export interface ChessView {
  board: string[];
  turn: 0 | 1;
  castling: string;
  ep: number;
  halfmove: number;
  fullmove: number;
  moves: string[];
  last: { from: number; to: number } | null;
  inCheck: boolean;
  result: ChessState['result'];
}

const same = (a: ChessMove, b: ChessMove) => a.from === b.from && a.to === b.to && (a.promo ?? '') === (b.promo ?? '');

/** Приводит пришедшее от клиента действие к допустимому виду (promo по умолчанию — ферзь). */
function normalize(s: ChessState, a: unknown): ChessMove | null {
  const m = a as Partial<ChessMove> | null;
  if (!m || !Number.isInteger(m.from) || !Number.isInteger(m.to)) return null;
  const from = m.from as number;
  const to = m.to as number;
  if (from < 0 || from > 63 || to < 0 || to > 63) return null;
  const piece = s.board[from] ?? '';
  const promoRank = s.turn === 0 ? 7 : 0;
  const isPromotion = piece.toLowerCase() === 'p' && to >> 3 === promoRank;
  const promo = isPromotion ? ((m.promo as Promo | undefined) ?? 'q') : undefined;
  if (promo !== undefined && !['q', 'r', 'b', 'n'].includes(promo)) return null;
  return { from, to, ...(promo ? { promo } : {}) };
}

function toOutcome(s: ChessState): Outcome | null {
  const r = s.result;
  if (!r) return null;
  return r.winner === null
    ? { winners: [], ranking: [0, 1], reason: r.reason }
    : { winners: [r.winner], ranking: [r.winner, 1 - r.winner], reason: r.reason };
}

/**
 * Шахматы. Место 0 — белые, место 1 — чёрные.
 * Ничья наступает автоматически: пат, недостаточный материал, троекратное повторение, правило 50 ходов.
 * Просрочка времени — поражение (timeoutAction не задан).
 */
export const chessGame: GameDefinition<ChessState, ChessMove, ChessView> = {
  slug: 'chess',
  minPlayers: 2,
  maxPlayers: 2,
  setup: () => initialState(),
  legalActions: (s, seat) => (s.result || s.turn !== seat ? [] : legalMoves(s)),
  validate: (s, seat, a) => {
    if (s.result) return fail('Партия уже завершена');
    if (s.turn !== seat) return fail('Сейчас не ход ваших фигур');
    const m = normalize(s, a);
    if (!m) return fail('Некорректный ход');
    return legalMoves(s).some((x) => same(x, m)) ? ok(undefined) : fail('Так ходить нельзя');
  },
  apply: (s, _seat, a) => {
    const ns = makeMove(s, normalize(s, a) as ChessMove, true);
    return { ...ns, result: evaluateResult(ns) };
  },
  currentSeats: (s) => (s.result ? [] : [s.turn]),
  outcome: toOutcome,
  view: (s) => ({
    board: s.board, turn: s.turn, castling: s.castling, ep: s.ep, halfmove: s.halfmove, fullmove: s.fullmove,
    moves: s.moves, last: s.last, inCheck: !s.result && inCheck(s), result: s.result,
  }),
  chooseBotAction: (s, _seat, bot) => chooseMove(s, bot),
};

export type { Seat };
