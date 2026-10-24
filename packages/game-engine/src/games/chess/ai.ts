import { createRng } from '../../core/rng';
import type { BotContext } from '../../core/types';
import { colorOf, inCheck, kingSquare, legalMoves, makeMove, rankOf, fileOf, isAttacked, type ChessMove, type ChessState, type Color } from './board';

const VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const MATE = 30000;

// Таблицы «ценности клетки» с точки зрения белых, первая строка — 8-я горизонталь (упрощённые Michniewski).
const PST: Record<string, number[]> = {
  p: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
  n: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
  b: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
  r: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
  q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
  k: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
};

/** Оценка позиции в сантипешках с точки зрения стороны, которая ходит. */
export function evaluate(s: ChessState): number {
  let score = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = s.board[sq]!;
    if (!p) continue;
    const kind = p.toLowerCase();
    const white = colorOf(p) === 0;
    // Для белых строка таблицы считается сверху, для чёрных — зеркально.
    const idx = white ? (7 - rankOf(sq)) * 8 + fileOf(sq) : rankOf(sq) * 8 + fileOf(sq);
    const v = VALUE[kind]! + PST[kind]![idx]!;
    score += white ? v : -v;
  }
  return s.turn === 0 ? score : -score;
}

const isCapture = (s: ChessState, m: ChessMove) => !!s.board[m.to] || (s.board[m.from]!.toLowerCase() === 'p' && m.to === s.ep);

/** Порядок перебора: сначала взятия «дорогой жертвой дешёвой фигурой» и превращения. */
function ordered(s: ChessState, moves: ChessMove[]): ChessMove[] {
  const score = (m: ChessMove) => {
    let v = 0;
    const victim = s.board[m.to];
    if (victim) v += 10 * VALUE[victim.toLowerCase()]! - VALUE[s.board[m.from]!.toLowerCase()]!;
    if (m.promo) v += VALUE[m.promo]!;
    return v;
  };
  return moves.map((m) => [score(m), m] as const).sort((a, b) => b[0] - a[0]).map(([, m]) => m);
}

class Search {
  nodes = 0;
  aborted = false;
  constructor(private budget: number) {}

  private quiesce(s: ChessState, alpha: number, beta: number, depth: number): number {
    this.nodes++;
    const stand = evaluate(s);
    if (depth === 0 || stand >= beta) return Math.max(stand, alpha) >= beta ? stand : stand;
    if (stand > alpha) alpha = stand;
    for (const m of ordered(s, legalMoves(s).filter((x) => isCapture(s, x) || x.promo))) {
      const score = -this.quiesce(makeMove(s, m, false), -beta, -alpha, depth - 1);
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  negamax(s: ChessState, depth: number, alpha: number, beta: number, ply: number): number {
    if (this.nodes > this.budget) {
      this.aborted = true;
      return 0;
    }
    const moves = legalMoves(s);
    if (moves.length === 0) return inCheck(s) ? -MATE + ply : 0;
    if (depth === 0) return this.quiesce(s, alpha, beta, 4);
    this.nodes++;
    let best = -Infinity;
    for (const m of ordered(s, moves)) {
      const score = -this.negamax(makeMove(s, m, false), depth - 1, -beta, -alpha, ply + 1);
      if (this.aborted) return 0;
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }
}

const LEVELS = {
  EASY: { depth: 1, budget: 2_000, noise: 120 },
  MEDIUM: { depth: 2, budget: 20_000, noise: 30 },
  HARD: { depth: 3, budget: 80_000, noise: 0 },
  EXPERT: { depth: 4, budget: 150_000, noise: 0 },
} as const;

/**
 * Выбор хода: итеративное углубление с лимитом узлов (детерминированный «бюджет времени»).
 * Лёгкие уровни добавляют шум к оценкам, чтобы играть неидеально и по-разному.
 */
export function chooseMove(s: ChessState, bot: BotContext): ChessMove {
  const cfg = LEVELS[bot.level];
  const rng = createRng(bot.rngSeed);
  const moves = ordered(s, legalMoves(s));
  let best: { m: ChessMove; score: number }[] = moves.map((m) => ({ m, score: 0 }));

  for (let depth = 1; depth <= cfg.depth; depth++) {
    const search = new Search(cfg.budget);
    const scored: { m: ChessMove; score: number }[] = [];
    let alpha = -Infinity;
    for (const { m } of best) {
      // Окно по alpha ускоряет перебор; с шумом считаем честно, чтобы сравнивать ходы.
      const score = -search.negamax(makeMove(s, m, false), depth - 1, -Infinity, cfg.noise ? Infinity : -alpha, 1);
      if (search.aborted) break;
      scored.push({ m, score });
      if (score > alpha) alpha = score;
    }
    if (search.aborted || scored.length < best.length) break; // не уложились — берём результат предыдущей глубины
    best = scored.sort((a, b) => b.score - a.score);
  }

  if (cfg.noise) {
    const noisy = best.map((x) => ({ ...x, score: x.score + (rng.next() - 0.5) * 2 * cfg.noise }));
    return noisy.sort((a, b) => b.score - a.score)[0]!.m;
  }
  // При равных оценках выбираем случайно — партии не повторяются.
  const top = best.filter((x) => x.score === best[0]!.score);
  return top[rng.int(top.length)]!.m;
}

// Экспорт для тестов
export { kingSquare, isAttacked };
export type { Color };
