import { createRng } from '../../core/rng';
import { fail, ok, type BotContext, type GameDefinition, type Outcome } from '../../core/types';

/**
 * Русские шашки. Клетка = rank * 8 + file; тёмные клетки — где (file + rank) чётно (a1 тёмная).
 * Фигуры: 'w' / 'b' — простые, 'W' / 'B' — дамки. Место 0 — белые (ходят первыми, вверх), место 1 — чёрные.
 *
 * Правила: взятие обязательно, в любую сторону (в том числе простой назад); серия взятий
 * должна быть закончена; шашка, дошедшая до последней горизонтали по ходу взятия, становится дамкой
 * и продолжает бить как дамка; дамка «летающая»; побитые фигуры снимаются после хода и не могут
 * быть перепрыгнуты дважды. Выбор из нескольких вариантов взятия — свободный.
 */
export interface CheckersState {
  board: string[];
  turn: 0 | 1;
  /** Ходов подряд без взятия и без хода простой шашкой (для ничьей). */
  quiet: number;
  keys: string[];
  moves: string[];
  last: number[] | null;
  result: { winner: 0 | 1 | null; reason: 'nomoves' | 'quiet' | 'repetition' } | null;
}

/** Ход — путь из клеток: [откуда, (промежуточные посадки...), куда]. */
export interface CheckersMove {
  path: number[];
}

export const QUIET_LIMIT = 30; // полуходов без взятий и ходов простых шашек → ничья
const DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

export const fileOf = (sq: number) => sq & 7;
export const rankOf = (sq: number) => sq >> 3;
export const sqName = (sq: number) => 'abcdefgh'[fileOf(sq)]! + String(rankOf(sq) + 1);
export const isDark = (sq: number) => (fileOf(sq) + rankOf(sq)) % 2 === 0;
const colorOf = (p: string): 0 | 1 => (p === 'w' || p === 'W' ? 0 : 1);
const isKing = (p: string) => p === 'W' || p === 'B';
const step = (sq: number, df: number, dr: number): number => {
  const f = fileOf(sq) + df;
  const r = rankOf(sq) + dr;
  return f < 0 || f > 7 || r < 0 || r > 7 ? -1 : r * 8 + f;
};

export function initialBoard(): string[] {
  const b: string[] = Array(64).fill('');
  for (let sq = 0; sq < 64; sq++) {
    if (!isDark(sq)) continue;
    if (rankOf(sq) <= 2) b[sq] = 'w';
    else if (rankOf(sq) >= 5) b[sq] = 'b';
  }
  return b;
}

export const initialState = (): CheckersState => {
  const s: CheckersState = { board: initialBoard(), turn: 0, quiet: 0, keys: [], moves: [], last: null, result: null };
  s.keys = [positionKey(s)];
  return s;
};

export const positionKey = (s: CheckersState) => `${s.board.map((p) => p || '.').join('')}${s.turn}`;

// ───────── генерация ходов ─────────

interface Capture {
  path: number[];
  taken: number[];
}

/** Все серии взятий фигуры с клетки `from`. Побитые фигуры остаются на доске до конца хода (нельзя перепрыгнуть дважды). */
function capturesFrom(board: string[], from: number, color: 0 | 1): Capture[] {
  const piece = board[from]!;
  const work = board.slice();
  work[from] = ''; // стартовая клетка освобождается — по ней можно проходить
  const out: Capture[] = [];

  const dfs = (pos: number, king: boolean, path: number[], taken: number[]) => {
    let extended = false;
    for (const [df, dr] of DIRS) {
      if (!king) {
        const mid = step(pos, df, dr);
        const land = mid < 0 ? -1 : step(mid, df, dr);
        if (mid < 0 || land < 0) continue;
        const m = work[mid]!;
        if (m && colorOf(m) !== color && !taken.includes(mid) && !work[land]) {
          extended = true;
          const promoted = rankOf(land) === (color === 0 ? 7 : 0);
          dfs(land, promoted, [...path, land], [...taken, mid]);
        }
      } else {
        // Дамка: скользим по пустым, первая занятая — потенциальная жертва.
        let cur = step(pos, df, dr);
        while (cur >= 0 && !work[cur]) cur = step(cur, df, dr);
        if (cur < 0) continue;
        const victim = work[cur]!;
        if (colorOf(victim) === color || taken.includes(cur)) continue;
        // Посадочные клетки за жертвой.
        const lands: number[] = [];
        for (let l = step(cur, df, dr); l >= 0 && !work[l]; l = step(l, df, dr)) lands.push(l);
        if (lands.length === 0) continue;
        extended = true;
        // Если с какой-то клетки можно бить дальше, обязаны выбрать именно такую.
        const withMore = lands.filter((l) => hasCapture(work, l, color, true, [...taken, cur]));
        for (const l of withMore.length ? withMore : lands) dfs(l, true, [...path, l], [...taken, cur]);
      }
    }
    if (!extended && path.length > 1) out.push({ path, taken });
  };
  dfs(from, isKing(piece), [from], []);
  return out;
}

/** Есть ли у фигуры (простой или дамки) на `pos` хотя бы одно взятие при уже побитых `taken`. */
function hasCapture(work: string[], pos: number, color: 0 | 1, king: boolean, taken: number[]): boolean {
  for (const [df, dr] of DIRS) {
    if (!king) {
      const mid = step(pos, df, dr);
      const land = mid < 0 ? -1 : step(mid, df, dr);
      if (mid >= 0 && land >= 0 && work[mid] && colorOf(work[mid]!) !== color && !taken.includes(mid) && !work[land]) return true;
    } else {
      let cur = step(pos, df, dr);
      while (cur >= 0 && !work[cur]) cur = step(cur, df, dr);
      if (cur < 0 || colorOf(work[cur]!) === color || taken.includes(cur)) continue;
      const l = step(cur, df, dr);
      if (l >= 0 && !work[l]) return true;
    }
  }
  return false;
}

export function legalMoves(s: CheckersState): CheckersMove[] {
  const { board, turn } = s;
  const captures: CheckersMove[] = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq]!;
    if (p && colorOf(p) === turn) for (const c of capturesFrom(board, sq, turn)) captures.push({ path: c.path });
  }
  if (captures.length) return captures; // взятие обязательно

  const quiet: CheckersMove[] = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq]!;
    if (!p || colorOf(p) !== turn) continue;
    if (isKing(p)) {
      for (const [df, dr] of DIRS) for (let t = step(sq, df, dr); t >= 0 && !board[t]; t = step(t, df, dr)) quiet.push({ path: [sq, t] });
    } else {
      const dr = turn === 0 ? 1 : -1;
      for (const df of [-1, 1]) {
        const t = step(sq, df, dr);
        if (t >= 0 && !board[t]) quiet.push({ path: [sq, t] });
      }
    }
  }
  return quiet;
}

/** Выполняет ход (путь должен быть допустимым). */
export function makeMove(s: CheckersState, m: CheckersMove, track = true): CheckersState {
  const board = s.board.slice();
  const from = m.path[0]!;
  const to = m.path[m.path.length - 1]!;
  const piece = board[from]!;
  let capturedAny = false;
  // Снимаем побитые: между каждыми двумя соседними точками пути ровно одна фигура соперника.
  for (let i = 0; i + 1 < m.path.length; i++) {
    const a = m.path[i]!;
    const b = m.path[i + 1]!;
    const df = Math.sign(fileOf(b) - fileOf(a));
    const dr = Math.sign(rankOf(b) - rankOf(a));
    for (let c = step(a, df, dr); c !== b && c >= 0; c = step(c, df, dr)) {
      if (board[c] && colorOf(board[c]!) !== colorOf(piece)) {
        board[c] = '';
        capturedAny = true;
      }
    }
  }
  board[from] = '';
  const promote = !isKing(piece) && rankOf(to) === (colorOf(piece) === 0 ? 7 : 0);
  board[to] = promote || m.path.some((q) => !isKing(piece) && rankOf(q) === (colorOf(piece) === 0 ? 7 : 0)) ? piece.toUpperCase() : piece;
  const ns: CheckersState = {
    board,
    turn: (1 - s.turn) as 0 | 1,
    quiet: capturedAny || !isKing(piece) ? 0 : s.quiet + 1,
    keys: s.keys,
    moves: s.moves,
    last: m.path,
    result: null,
  };
  if (track) {
    ns.moves = [...s.moves, m.path.map(sqName).join(m.path.length > 2 || capturedAny ? ':' : '-')];
    ns.keys = [...s.keys, positionKey(ns)];
  }
  return ns;
}

export function evaluateResult(s: CheckersState): CheckersState['result'] {
  if (legalMoves(s).length === 0) return { winner: (1 - s.turn) as 0 | 1, reason: 'nomoves' };
  if (s.quiet >= QUIET_LIMIT) return { winner: null, reason: 'quiet' };
  const key = s.keys[s.keys.length - 1];
  if (key && s.keys.filter((k) => k === key).length >= 3) return { winner: null, reason: 'repetition' };
  return null;
}

// ───────── определение игры ─────────

const samePath = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export const checkersGame: GameDefinition<CheckersState, CheckersMove, CheckersState> = {
  slug: 'checkers',
  minPlayers: 2,
  maxPlayers: 2,
  setup: () => initialState(),
  currentSeats: (s) => (s.result ? [] : [s.turn]),
  legalActions: (s, seat) => (s.result || s.turn !== seat ? [] : legalMoves(s)),
  validate: (s, seat, a) => {
    if (s.result) return fail('Партия завершена');
    if (s.turn !== seat) return fail('Сейчас ход соперника');
    const path = (a as CheckersMove | null)?.path;
    if (!Array.isArray(path) || path.length < 2 || !path.every((q) => Number.isInteger(q) && q >= 0 && q < 64)) return fail('Некорректный ход');
    const legal = legalMoves(s);
    if (legal.some((m) => samePath(m.path, path))) return ok(undefined);
    // Подсказка игроку: если есть взятие — ходить простым ходом нельзя.
    const mustCapture = legal.some((m) => m.path.length > 2 || Math.abs(rankOf(m.path[1]!) - rankOf(m.path[0]!)) > 1);
    return fail(mustCapture ? 'Взятие обязательно' : 'Так ходить нельзя');
  },
  apply: (s, _seat, a) => {
    const ns = makeMove(s, a, true);
    return { ...ns, result: evaluateResult(ns) };
  },
  outcome: (s): Outcome | null => {
    const r = s.result;
    if (!r) return null;
    return r.winner === null
      ? { winners: [], ranking: [0, 1], reason: r.reason }
      : { winners: [r.winner], ranking: [r.winner, 1 - r.winner], reason: r.reason === 'nomoves' ? 'nomoves' : r.reason };
  },
  view: (s) => ({ ...s, keys: [] }),
  chooseBotAction: (s, _seat, bot) => chooseMove(s, bot),
};

// ───────── бот ─────────

const LEVELS = {
  EASY: { depth: 1, budget: 500, noise: 60 },
  MEDIUM: { depth: 3, budget: 8_000, noise: 15 },
  HARD: { depth: 5, budget: 40_000, noise: 0 },
  EXPERT: { depth: 7, budget: 120_000, noise: 0 },
} as const;
const MATE = 100000;

function evaluate(s: CheckersState): number {
  let score = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = s.board[sq]!;
    if (!p) continue;
    const white = colorOf(p) === 0;
    let v: number;
    if (isKing(p)) v = 320;
    else {
      const adv = white ? rankOf(sq) : 7 - rankOf(sq);
      v = 100 + adv * 6 + (adv === 0 ? 8 : 0); // продвижение и нетронутая тыловая линия
    }
    const centre = 3.5 - Math.abs(fileOf(sq) - 3.5);
    v += centre * 2;
    score += white ? v : -v;
  }
  return s.turn === 0 ? score : -score;
}

function negamax(s: CheckersState, depth: number, alpha: number, beta: number, ply: number, ctx: { nodes: number; budget: number; aborted: boolean }): number {
  if (++ctx.nodes > ctx.budget) {
    ctx.aborted = true;
    return 0;
  }
  const moves = legalMoves(s);
  if (moves.length === 0) return -MATE + ply;
  if (depth === 0) return evaluate(s);
  // Взятия первыми — отсечения срабатывают раньше.
  moves.sort((a, b) => b.path.length - a.path.length);
  let best = -Infinity;
  for (const m of moves) {
    const score = -negamax(makeMove(s, m, false), depth - 1, -beta, -alpha, ply + 1, ctx);
    if (ctx.aborted) return 0;
    best = Math.max(best, score);
    alpha = Math.max(alpha, best);
    if (alpha >= beta) break;
  }
  return best;
}

export function chooseMove(s: CheckersState, bot: BotContext): CheckersMove {
  const cfg = LEVELS[bot.level];
  const rng = createRng(bot.rngSeed);
  const moves = legalMoves(s);
  if (moves.length === 1) return moves[0]!;
  let ranked = moves.map((m) => ({ m, score: 0 }));
  for (let depth = 1; depth <= cfg.depth; depth++) {
    const ctx = { nodes: 0, budget: cfg.budget, aborted: false };
    const scored = ranked.map(({ m }) => ({ m, score: -negamax(makeMove(s, m, false), depth - 1, -Infinity, Infinity, 1, ctx) }));
    if (ctx.aborted) break;
    ranked = scored.sort((a, b) => b.score - a.score);
  }
  if (cfg.noise) {
    return ranked.map((x) => ({ ...x, score: x.score + (rng.next() - 0.5) * 2 * cfg.noise })).sort((a, b) => b.score - a.score)[0]!.m;
  }
  const top = ranked.filter((x) => x.score === ranked[0]!.score);
  return top[rng.int(top.length)]!.m;
}
