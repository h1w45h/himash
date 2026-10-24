import { createRng } from '../../core/rng';
import type { BotContext, Seat } from '../../core/types';
import { evaluate, rankOf } from './eval';
import { blindsFor, pokerGame, potOf, raiseOptions, toCall, type PokerAction, type PokerState } from './index';

/** Оценка шансов на победу методом Монте-Карло против случайных рук соперников. */
export function equity(s: PokerState, seat: Seat, iterations: number, seed: string): number {
  const opponents = s.folded.filter((f, i) => !f && !s.out[i] && i !== seat).length;
  if (opponents === 0) return 1;
  const rng = createRng(seed);
  const known = new Set([...s.hole[seat]!, ...s.board]);
  const rest = Array.from({ length: 52 }, (_, i) => i).filter((c) => !known.has(c));
  let score = 0;
  for (let it = 0; it < iterations; it++) {
    // частичное перемешивание — берём нужное число карт
    const need = 5 - s.board.length + opponents * 2;
    for (let i = 0; i < need; i++) {
      const j = i + rng.int(rest.length - i);
      [rest[i], rest[j]] = [rest[j]!, rest[i]!];
    }
    const board = [...s.board, ...rest.slice(0, 5 - s.board.length)];
    const mine = evaluate([...s.hole[seat]!, ...board]);
    let best = 0;
    let ties = 1;
    let idx = 5 - s.board.length;
    for (let o = 0; o < opponents; o++) {
      const v = evaluate([rest[idx]!, rest[idx + 1]!, ...board]);
      idx += 2;
      if (v > best) best = v;
      void ties;
    }
    if (mine > best) score += 1;
    else if (mine === best) score += 0.5;
  }
  return score / iterations;
}

/** Грубая оценка стартовой руки без симуляции (для лёгкого уровня): 0..1. */
function preflopStrength(hole: number[]): number {
  const [a, b] = hole.map((c) => rankOf(c)) as [number, number];
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const pair = a === b;
  const suited = (hole[0]! & 3) === (hole[1]! & 3);
  let v = (hi + 2) / 14 * 0.5 + (lo + 2) / 14 * 0.2;
  if (pair) v += 0.3;
  if (suited) v += 0.05;
  if (hi - lo <= 2 && !pair) v += 0.04;
  return Math.min(1, v);
}

const ITER = { EASY: 0, MEDIUM: 120, HARD: 300, EXPERT: 600 } as const;

/**
 * Бот: оценивает шансы (Монте-Карло) и сравнивает их с ценой колла.
 * Сильная рука — рейз по размеру банка, средняя — колл при выгодных шансах, слабая — фолд/чек.
 * Короткий стек (<10 блайндов) играет «пуш или фолд». Небольшая доля блефов зависит от уровня.
 */
export function choosePokerAction(s: PokerState, seat: Seat, bot: BotContext): PokerAction {
  const legal = pokerGame.legalActions(s, seat);
  const rng = createRng(bot.rngSeed);
  const call = toCall(s, seat);
  const pot = potOf(s);
  const [, bb] = blindsFor(s.level);
  const canCheck = call === 0;
  const raises = legal.filter((a): a is Extract<PokerAction, { t: 'raise' }> => a.t === 'raise');
  const fold = canCheck ? ({ t: 'check' } as const) : ({ t: 'fold' } as const);
  const passive = canCheck ? ({ t: 'check' } as const) : ({ t: 'call' } as const);

  const iters = ITER[bot.level];
  const eq = iters > 0 ? equity(s, seat, iters, `${bot.rngSeed}:eq`) : preflopStrength(s.hole[seat]!) * (s.board.length ? 0.9 : 1);
  const odds = call / (pot + call || 1);
  const bluff = (bot.level === 'EXPERT' ? 0.07 : bot.level === 'HARD' ? 0.05 : 0.02) > rng.next();
  const pick = (target: number) => raises.slice().sort((a, b) => Math.abs(a.to - target) - Math.abs(b.to - target))[0];

  // Короткий стек — пуш или фолд.
  if (s.stacks[seat]! < bb * 10 && raises.length) {
    const jam = raises[raises.length - 1]!;
    if (eq > 0.5 || (bluff && canCheck)) return jam;
    return call <= bb ? passive : fold;
  }

  if (eq > 0.78 && raises.length) return pick(s.currentBet + pot) ?? passive;
  if (eq > 0.6 && raises.length && rng.next() < 0.7) return pick(s.currentBet + Math.round(pot / 2)) ?? passive;
  if (bluff && raises.length && canCheck && s.board.length >= 3) return pick(s.currentBet + Math.round(pot / 2)) ?? passive;
  if (canCheck) return passive;
  // Колл, если шансы на победу лучше цены колла (с запасом на неопределённость оценки).
  const margin = bot.level === 'EASY' ? -0.05 : 0.03;
  return eq > odds + margin ? passive : fold;
}
