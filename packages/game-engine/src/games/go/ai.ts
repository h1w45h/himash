import { createRng } from '../../core/rng';
import type { BotContext } from '../../core/types';
import { areaScore, groupAt, hashBoard, neighborTable, opponent, place } from './board';
import { colorOf, legalPlacements, type GoAction, type GoState } from './index';

const LEVELS = {
  EASY: { candidates: 0, playouts: 0 },
  MEDIUM: { candidates: 8, playouts: 25 },
  HARD: { candidates: 10, playouts: 70 },
  EXPERT: { candidates: 12, playouts: 160 },
} as const;

/** Свой «глаз»: все соседи — свои камни (заполнять его бессмысленно). */
function isOwnEye(board: number[], size: number, i: number, color: 1 | 2): boolean {
  const nb = neighborTable(size)[i]!;
  return nb.every((n) => board[n] === color);
}

/** Быстрый случайный розыгрыш до конца; возвращает true, если выиграл `me`. */
function playout(board0: number[], size: number, toMove: 1 | 2, me: 1 | 2, komi: number, rng: ReturnType<typeof createRng>): boolean {
  const board = board0.slice();
  let color = toMove;
  let passes = 0;
  const cap = size * size * 2;
  for (let step = 0; step < cap && passes < 2; step++) {
    const empties: number[] = [];
    for (let i = 0; i < board.length; i++) if (board[i] === 0 && !isOwnEye(board, size, i, color)) empties.push(i);
    let moved = false;
    for (let tries = 0; tries < 12 && empties.length; tries++) {
      const k = rng.int(empties.length);
      const at = empties[k]!;
      if (place(board, size, at, color)) {
        moved = true;
        break;
      }
      empties[k] = empties[empties.length - 1]!;
      empties.pop();
    }
    passes = moved ? 0 : passes + 1;
    color = opponent(color);
  }
  const { black, white } = areaScore(board, size);
  const blackWins = black > white + komi;
  return me === 1 ? blackWins : !blackWins;
}

/** Эвристическая оценка хода для отбора кандидатов. */
function heuristic(s: GoState, at: number, board: number[], captured: number[], color: 1 | 2): number {
  const size = s.size;
  const nb = neighborTable(size);
  const x = at % size;
  const y = (at / size) | 0;
  const edge = Math.min(x, y, size - 1 - x, size - 1 - y);
  let v = 0;
  v += captured.length * 25; // взятие почти всегда правильно — играть вслепую розыгрышами тут незачем
  // Спасаем свои группы в атари и ставим соперника в атари.
  const enemy = opponent(color);
  for (const n of nb[at]!) {
    if (board[n] === enemy && groupAt(board, size, n).liberties.size === 1) v += 6;
  }
  const own = groupAt(board, size, at);
  if (own.liberties.size === 1) v -= 14; // ход в самоатари
  // Спасение своей группы из атари: до хода у соседней группы была одна свобода, теперь больше.
  if (own.liberties.size >= 2 && nb[at]!.some((n) => s.board[n] === color && groupAt(s.board, size, n).liberties.size === 1)) v += 14;
  v += Math.min(own.liberties.size, 4);
  if (edge === 0) v -= 3;
  else if (edge === 1) v -= 0.5;
  else v += Math.min(edge, 3) * 0.7;
  // Близость к уже стоящим камням.
  let near = 0;
  for (let i = 0; i < board.length; i++) if (board[i] !== 0) {
    const d = Math.abs((i % size) - x) + Math.abs(((i / size) | 0) - y);
    if (d <= 2) near++;
  }
  if (s.moves > 0) v += Math.min(near, 4) * 0.8;
  // Угловые и боковые точки в начале партии
  if (s.moves < 8) {
    const star = size === 9 ? [2, 4, 6] : [3, size >> 1, size - 4];
    if (star.includes(x) && star.includes(y)) v += 4;
  }
  return v;
}

export function chooseGoMove(s: GoState, bot: BotContext): GoAction {
  const base = LEVELS[bot.level];
  // На больших досках розыгрыш дороже пропорционально площади — уменьшаем их число, чтобы ход не занимал секунды.
  const cfg = { candidates: base.candidates, playouts: base.playouts === 0 ? 0 : Math.max(4, Math.round(base.playouts * Math.min(1, 81 / (s.size * s.size)))) };
  const rng = createRng(bot.rngSeed);
  const color = colorOf(s.turn);
  const legal = legalPlacements(s).filter((i) => !isOwnEye(s.board, s.size, i, color));

  // Соперник спасовал и мы выигрываем по очкам — тоже пасуем, завершая партию.
  if (s.passes === 1) {
    const { black, white } = areaScore(s.board, s.size);
    const lead = color === 1 ? black - (white + s.komi) : white + s.komi - black;
    if (lead > 0) return { t: 'pass' };
  }
  if (legal.length === 0) return { t: 'pass' };

  const scored = legal
    .map((at) => {
      const b = s.board.slice();
      const r = place(b, s.size, at, color)!;
      return { at, board: b, h: heuristic(s, at, b, r.captured, color) + rng.next() * (bot.level === 'EASY' ? 6 : 0.5) };
    })
    .sort((a, b) => b.h - a.h);

  if (cfg.candidates === 0) {
    // Лёгкий уровень: лучший по эвристике с шумом.
    return { t: 'place', at: scored[0]!.at };
  }

  let best = scored[0]!;
  let bestRate = -1;
  for (const cand of scored.slice(0, cfg.candidates)) {
    let wins = 0;
    for (let k = 0; k < cfg.playouts; k++) if (playout(cand.board, s.size, opponent(color), color, s.komi, rng)) wins++;
    // Розыгрышей мало, поэтому эвристика (взятия, атари, самоатари) весит заметно — иначе шум их пересилит.
    const rate = wins / cfg.playouts + cand.h * 0.025;
    if (rate > bestRate) {
      bestRate = rate;
      best = cand;
    }
  }
  // Позиция проиграна и ход не улучшает её — лучше пас, чем бессмысленные ходы, только на поздней стадии.
  if (bestRate < 0.04 && s.moves > s.size * s.size * 0.8) return { t: 'pass' };
  void hashBoard;
  return { t: 'place', at: best.at };
}
