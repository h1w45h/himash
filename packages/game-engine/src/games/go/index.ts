import { fail, ok, type BotContext, type GameDefinition, type Outcome } from '../../core/types';
import { chooseGoMove } from './ai';
import { areaScore, hashBoard, opponent, place } from './board';

export * from './board';

/**
 * Го. Место 0 — чёрные (ходят первыми), место 1 — белые. Подсчёт по площади (Тромпу–Тейлору) с коми:
 * мёртвые камни нужно снимать игрой — спорные группы автоматически «живыми» не считаются, они просто остаются на доске.
 * Запрещено самоубийство и повтор любой прежней позиции (позиционное суперко, правило ко).
 */
export interface GoState {
  size: number;
  board: number[];
  turn: 0 | 1;
  /** Захваченные камни: [чёрными, белыми]. */
  captures: [number, number];
  komi: number;
  /** Хеши всех встречавшихся позиций. */
  seen: number[];
  passes: number;
  moves: number;
  last: number | null;
  /** Последний ход: индекс точки, 'pass' или 'resign'. */
  lastMove: number | 'pass' | 'resign' | null;
  result: { winner: 0 | 1; reason: 'score' | 'resign' | 'limit'; black?: number; white?: number } | null;
}

export type GoAction = { t: 'place'; at: number } | { t: 'pass' } | { t: 'resign' };

const KOMI: Record<number, number> = { 9: 5.5, 13: 6.5, 19: 6.5 };
export const colorOf = (turn: 0 | 1): 1 | 2 => (turn === 0 ? 1 : 2);

export function initialState(size = 9): GoState {
  const board = Array(size * size).fill(0);
  return { size, board, turn: 0, captures: [0, 0], komi: KOMI[size] ?? 6.5, seen: [hashBoard(board)], passes: 0, moves: 0, last: null, lastMove: null, result: null };
}

/** Результат гипотетического хода: новая доска или причина запрета. */
export function tryPlace(s: GoState, at: number): { board: number[]; captured: number[] } | { error: string } {
  if (!Number.isInteger(at) || at < 0 || at >= s.size * s.size) return { error: 'Вне доски' };
  if (s.board[at] !== 0) return { error: 'Пункт занят' };
  const board = s.board.slice();
  const res = place(board, s.size, at, colorOf(s.turn));
  if (!res) return { error: 'Самоубийство запрещено' };
  if (s.seen.includes(hashBoard(board))) return { error: 'Ко: нельзя повторять позицию' };
  return { board, captured: res.captured };
}

export const legalPlacements = (s: GoState): number[] => {
  const out: number[] = [];
  for (let i = 0; i < s.board.length; i++) if (s.board[i] === 0 && !('error' in tryPlace(s, i))) out.push(i);
  return out;
};

function finishByScore(s: GoState, reason: 'score' | 'limit'): GoState {
  const { black, white } = areaScore(s.board, s.size);
  return { ...s, result: { winner: black > white + s.komi ? 0 : 1, reason, black, white: white + s.komi } };
}

export const goGame: GameDefinition<GoState, GoAction, GoState, { variant?: string }> = {
  slug: 'go',
  minPlayers: 2,
  maxPlayers: 2,
  setup: ({ variant }) => initialState(variant === '13' ? 13 : variant === '19' ? 19 : 9),
  currentSeats: (s) => (s.result ? [] : [s.turn]),

  legalActions: (s, seat) => {
    if (s.result || s.turn !== seat) return [];
    return [...legalPlacements(s).map((at): GoAction => ({ t: 'place', at })), { t: 'pass' }, { t: 'resign' }];
  },

  validate: (s, seat, a) => {
    if (s.result) return fail('Партия завершена');
    if (s.turn !== seat) return fail('Сейчас ход соперника');
    const act = a as GoAction | null;
    if (!act || typeof act !== 'object') return fail('Некорректное действие');
    if (act.t === 'pass' || act.t === 'resign') return ok(undefined);
    if (act.t !== 'place') return fail('Неизвестное действие');
    const r = tryPlace(s, act.at);
    return 'error' in r ? fail(r.error) : ok(undefined);
  },

  apply: (s, seat, a) => {
    if (a.t === 'resign') return { ...s, lastMove: 'resign', result: { winner: (1 - seat) as 0 | 1, reason: 'resign' } };
    if (a.t === 'pass') {
      const next: GoState = { ...s, turn: (1 - s.turn) as 0 | 1, passes: s.passes + 1, moves: s.moves + 1, lastMove: 'pass', last: null };
      return next.passes >= 2 ? finishByScore(next, 'score') : next;
    }
    const r = tryPlace(s, a.at) as { board: number[]; captured: number[] };
    const captures: [number, number] = [s.captures[0], s.captures[1]];
    captures[s.turn] += r.captured.length;
    const next: GoState = {
      ...s, board: r.board, turn: (1 - s.turn) as 0 | 1, captures, passes: 0, moves: s.moves + 1,
      seen: [...s.seen, hashBoard(r.board)], last: a.at, lastMove: a.at,
    };
    // Страховка от бесконечной партии.
    return next.moves >= s.size * s.size * 3 ? finishByScore(next, 'limit') : next;
  },

  outcome: (s): Outcome | null => {
    const r = s.result;
    if (!r) return null;
    return { winners: [r.winner], ranking: [r.winner, 1 - r.winner], reason: r.reason, ...(r.black !== undefined ? { scores: { 0: r.black, 1: r.white! } } : {}) };
  },

  view: (s) => ({ ...s, seen: [] }),
  timeoutAction: () => ({ t: 'pass' }) as GoAction & { t: 'pass' },
  chooseBotAction: (s: GoState, seat: number, bot: BotContext) => chooseGoMove(s, bot),
};

export { areaScore, opponent };
