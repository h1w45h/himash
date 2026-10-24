import { createRng } from '../../core/rng';
import { fail, ok, type BotContext, type GameDefinition, type Outcome, type Seat } from '../../core/types';

/**
 * Длинные нарды. Каждый игрок идёт по «своей» дорожке p = 0…23 (0 — голова, 18…23 — дом, дальше — вывод).
 * Абсолютная точка игрока 0 равна p, игрока 1 — (p + 12) % 24, поэтому дорожки зеркальны и общее поле согласовано.
 *
 * Правила: шашки не бьются; на пункт соперника вставать нельзя; с головы за ход — одна шашка
 * (в первый свой ход при дубле 3, 4 или 6 — две); нельзя строить шесть своих пунктов подряд, если впереди
 * этого блока нет ни одной шашки соперника; нужно использовать максимум костей (если можно сыграть одну —
 * большую); вывод — когда все 15 шашек дома. «Марс» — победа, пока соперник не вывел ни одной шашки.
 */
export interface BackgammonState {
  /** pos[игрок][p] — число шашек игрока на его позиции p. */
  pos: [number[], number[]];
  off: [number, number];
  turn: 0 | 1;
  phase: 'roll' | 'move';
  /** Выпавшие кости этого хода и ещё не сыгранные. */
  dice: [number, number] | null;
  remaining: number[];
  headUsed: number;
  /** Сколько ходов уже сделал каждый игрок — для правила первого хода. */
  turnsTaken: [number, number];
  rng: number;
  log: string[];
  winner: Seat | null;
  mars: boolean;
}

export type BackgammonAction = { t: 'roll' } | { t: 'move'; from: number; die: number };

export interface Move {
  from: number;
  die: number;
}

const N = 24;
const HOME = 18;
const MAX_LOG = 6;

const opp = (p: 0 | 1): 0 | 1 => (1 - p) as 0 | 1;
/** Позиция p игрока в дорожке соперника. */
const toOpp = (p: number) => (p + 12) % N;
const clone = (s: BackgammonState): BackgammonState => JSON.parse(JSON.stringify(s)) as BackgammonState;
const log = (s: BackgammonState, t: string) => {
  s.log.push(t);
  if (s.log.length > MAX_LOG) s.log.shift();
};
const name = (p: number) => (p === 0 ? 'Белые' : 'Чёрные');

export const pips = (s: BackgammonState, p: 0 | 1) => s.pos[p].reduce((n, c, i) => n + c * (N - i), 0);
export const allHome = (s: BackgammonState, p: 0 | 1) => s.pos[p].slice(0, HOME).every((c) => c === 0);

function headLimit(s: BackgammonState): number {
  const d = s.dice;
  const firstTurn = s.turnsTaken[s.turn] === 0;
  return firstTurn && d && d[0] === d[1] && [3, 4, 6].includes(d[0]) ? 2 : 1;
}

/** Есть ли шесть подряд занятых пунктов игрока `p`, включающих `through`, без шашек соперника впереди. */
function illegalBlock(s: BackgammonState, p: 0 | 1, through: number): boolean {
  const mine = s.pos[p];
  let lo = through;
  let hi = through;
  while (lo > 0 && mine[lo - 1]! > 0) lo--;
  while (hi < N - 1 && mine[hi + 1]! > 0) hi++;
  if (hi - lo + 1 < 6) return false;
  // Шашка соперника «впереди» блока — если в моей системе координат она правее hi.
  const o = s.pos[opp(p)];
  for (let q = 0; q < N; q++) if (o[q]! > 0 && toOpp(q) > hi) return false;
  return true;
}

function canMove(s: BackgammonState, p: 0 | 1, from: number, die: number, headUsed: number, limit: number): boolean {
  if ((s.pos[p][from] ?? 0) === 0) return false;
  if (from === 0 && headUsed >= limit) return false;
  const dest = from + die;
  if (dest >= N) {
    if (!allHome(s, p)) return false;
    if (dest === N) return true;
    // Большей костью выводим, только если позади (дальше от выхода) своих шашек нет.
    for (let q = HOME; q < from; q++) if (s.pos[p][q]! > 0) return false;
    return true;
  }
  if (s.pos[opp(p)][toOpp(dest)]! > 0) return false; // пункт занят соперником
  // Проверка блока: считаем так, будто ход уже сделан.
  const mine = s.pos[p];
  mine[from]!--;
  mine[dest]!++;
  const bad = illegalBlock(s, p, dest);
  mine[from]!++;
  mine[dest]!--;
  return !bad;
}

/** Все одиночные ходы без учёта правила максимального использования костей. */
function rawMoves(s: BackgammonState, dice: number[], headUsed: number): Move[] {
  const limit = headLimit(s);
  const out: Move[] = [];
  for (const die of new Set(dice)) for (let from = 0; from < N; from++) if (canMove(s, s.turn, from, die, headUsed, limit)) out.push({ from, die });
  return out;
}

function play(s: BackgammonState, m: Move): void {
  const p = s.turn;
  s.pos[p][m.from]!--;
  if (m.from === 0) s.headUsed++;
  const dest = m.from + m.die;
  if (dest >= N) s.off[p]++;
  else s.pos[p][dest]!++;
  s.remaining.splice(s.remaining.indexOf(m.die), 1);
}

/** Максимальное число костей, которое ещё можно сыграть из позиции (для правила «использовать максимум»). */
function maxPlayable(s: BackgammonState): number {
  const memo = new Map<string, number>();
  const rec = (st: BackgammonState): number => {
    if (st.remaining.length === 0) return 0;
    const key = `${st.pos[st.turn].join()}|${st.remaining.slice().sort().join()}|${st.headUsed}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let best = 0;
    for (const m of rawMoves(st, st.remaining, st.headUsed)) {
      const next = clone(st);
      play(next, m);
      best = Math.max(best, 1 + rec(next));
      if (best === st.remaining.length) break;
    }
    memo.set(key, best);
    return best;
  };
  return rec(s);
}

export function legalMoves(s: BackgammonState): Move[] {
  if (s.phase !== 'move' || s.winner !== null) return [];
  const cands = rawMoves(s, s.remaining, s.headUsed);
  if (cands.length === 0) return [];
  const best = maxPlayable(s);
  const filtered = cands.filter((m) => {
    const next = clone(s);
    play(next, m);
    return 1 + maxPlayable(next) === best;
  });
  // Можно сыграть только одну кость из двух разных — обязаны сыграть большую.
  if (best === 1 && new Set(s.remaining).size === 2) {
    const big = Math.max(...filtered.map((m) => m.die));
    return filtered.filter((m) => m.die === big);
  }
  return filtered;
}

// ───────── ход игры ─────────

function endTurn(s: BackgammonState) {
  s.turnsTaken[s.turn]++;
  s.turn = opp(s.turn);
  s.phase = 'roll';
  s.dice = null;
  s.remaining = [];
  s.headUsed = 0;
}

function checkEnd(s: BackgammonState): boolean {
  const p = s.turn;
  if (s.off[p] < 15) return false;
  s.winner = p;
  s.mars = s.off[opp(p)] === 0;
  log(s, `${name(p)} выводят все шашки — ${s.mars ? 'марс (двойная победа)!' : 'победа!'}`);
  return true;
}

/** После хода: если сыграть больше нечем — ход переходит. */
function settle(s: BackgammonState) {
  if (checkEnd(s)) return;
  if (s.remaining.length === 0 || legalMoves(s).length === 0) {
    if (s.remaining.length > 0) log(s, `${name(s.turn)}: остальные кости сыграть нечем.`);
    endTurn(s);
  }
}

export function initialState(seed: string): BackgammonState {
  const pos: [number[], number[]] = [Array(N).fill(0), Array(N).fill(0)];
  pos[0][0] = 15;
  pos[1][0] = 15;
  return {
    pos, off: [0, 0], turn: 0, phase: 'roll', dice: null, remaining: [], headUsed: 0, turnsTaken: [0, 0],
    rng: createRng(seed).state, log: ['Белые ходят первыми.'], winner: null, mars: false,
  };
}

export const backgammonGame: GameDefinition<BackgammonState, BackgammonAction> = {
  slug: 'backgammon',
  minPlayers: 2,
  maxPlayers: 2,
  setup: ({ seed }) => initialState(seed),
  currentSeats: (s) => (s.winner === null ? [s.turn] : []),

  legalActions: (s, seat) => {
    if (s.winner !== null || s.turn !== seat) return [];
    if (s.phase === 'roll') return [{ t: 'roll' }];
    return legalMoves(s).map((m) => ({ t: 'move', from: m.from, die: m.die }));
  },

  validate: (s, seat, a) => {
    if (s.winner !== null) return fail('Партия завершена');
    if (s.turn !== seat) return fail('Сейчас ход соперника');
    const act = a as BackgammonAction | null;
    if (!act || typeof act !== 'object') return fail('Некорректное действие');
    if (act.t === 'roll') return s.phase === 'roll' ? ok(undefined) : fail('Кости уже брошены');
    if (act.t === 'move') {
      if (s.phase !== 'move') return fail('Сначала бросьте кости');
      return legalMoves(s).some((m) => m.from === act.from && m.die === act.die) ? ok(undefined) : fail('Так ходить нельзя');
    }
    return fail('Неизвестное действие');
  },

  apply: (prev, _seat, a) => {
    const s = clone(prev);
    if (a.t === 'roll') {
      const rng = createRng(s.rng);
      const d1 = rng.int(6) + 1;
      const d2 = rng.int(6) + 1;
      s.rng = rng.state;
      s.dice = [d1, d2];
      s.remaining = d1 === d2 ? [d1, d1, d1, d1] : [d1, d2];
      s.headUsed = 0;
      s.phase = 'move';
      log(s, `${name(s.turn)} бросают ${d1} и ${d2}${d1 === d2 ? ' (дубль)' : ''}.`);
      if (legalMoves(s).length === 0) {
        log(s, `${name(s.turn)}: ходов нет.`);
        endTurn(s);
      }
      return s;
    }
    play(s, { from: a.from, die: a.die });
    settle(s);
    return s;
  },

  outcome: (s): Outcome | null =>
    s.winner === null ? null : { winners: [s.winner], ranking: [s.winner, opp(s.winner as 0 | 1)], reason: s.mars ? 'mars' : 'oin' },

  view: (s) => s,

  timeoutAction: (s, seat) => {
    if (s.phase === 'roll') return { t: 'roll' };
    const m = legalMoves(s)[0];
    return m ? { t: 'move', from: m.from, die: m.die } : null;
  },

  chooseBotAction: (s, seat, bot) => chooseBot(s, bot),
};

// ───────── бот ─────────

interface Plan {
  first: Move;
  state: BackgammonState;
}

/** Все различные итоговые позиции хода (перебор последовательностей, дубли по позиции отсекаются). */
function enumeratePlans(s: BackgammonState, limit = 600): Plan[] {
  const seen = new Set<string>();
  const out: Plan[] = [];
  const rec = (st: BackgammonState, first: Move | null) => {
    if (out.length >= limit) return;
    const moves = legalMoves(st);
    if (moves.length === 0 || st.phase !== 'move' || st.winner !== null) {
      if (first) {
        const key = `${st.pos[s.turn].join()}|${st.off[s.turn]}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ first, state: st });
        }
      }
      return;
    }
    for (const m of moves) {
      const next = clone(st);
      play(next, m);
      // без settle: план — это серия ходов в рамках одного хода; победа/смена хода определяется позже
      if (next.remaining.length === 0 || next.off[next.turn] === 15) {
        const key = `${next.pos[s.turn].join()}|${next.off[s.turn]}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ first: first ?? m, state: next });
        }
      } else rec(next, first ?? m);
    }
  };
  rec(s, null);
  return out;
}

/** Оценка позиции с точки зрения игрока `p`: меньше «пипсов» лучше, плюс блоки перед соперником и вывод. */
function evaluate(s: BackgammonState, p: 0 | 1, level: BotContext['level']): number {
  const me = s.pos[p];
  let score = (pips(s, opp(p)) - pips(s, p)) * 1.0 + s.off[p] * 6;
  // Серии подряд идущих своих пунктов (перед соперником) — главное оружие в длинных нардах.
  let run = 0;
  let best = 0;
  for (let i = 0; i < N; i++) {
    if (me[i]! > 0) {
      run++;
      best = Math.max(best, run);
    } else run = 0;
  }
  const blockWeight = level === 'EXPERT' ? 5 : level === 'HARD' ? 4 : 2;
  score += Math.min(best, 5) * blockWeight;
  // Не задерживаем голову, но и не торопимся: шашки с головы — потенциал выбора.
  score -= (me[0] ?? 0) * (level === 'MEDIUM' ? 0.5 : 1.2);
  // Шашки соперника на нашем пути дальше блока меньше мешают: считаем количество закрытых для него пунктов впереди.
  let blockedAhead = 0;
  for (let q = 0; q < N; q++) if (s.pos[opp(p)][q]! > 0) for (let d = 1; d <= 6; d++) if (me[toOpp((q + d) % N)]! > 0) blockedAhead++;
  score += blockedAhead * (level === 'EXPERT' || level === 'HARD' ? 0.4 : 0.15);
  return score;
}

function chooseBot(s: BackgammonState, bot: BotContext): BackgammonAction {
  if (s.phase === 'roll') return { t: 'roll' };
  const rng = createRng(bot.rngSeed);
  const legal = legalMoves(s);
  if (legal.length === 1) return { t: 'move', ...legal[0]! };
  if (bot.level === 'EASY' && rng.next() < 0.6) {
    const m = legal[rng.int(legal.length)]!;
    return { t: 'move', from: m.from, die: m.die };
  }
  const plans = enumeratePlans(s);
  let best = plans[0];
  let bestScore = -Infinity;
  for (const p of plans) {
    const sc = evaluate(p.state, s.turn, bot.level) + (bot.level === 'MEDIUM' ? rng.next() * 3 : 0);
    if (sc > bestScore) {
      bestScore = sc;
      best = p;
    }
  }
  const m = best?.first ?? legal[0]!;
  return { t: 'move', from: m.from, die: m.die };
}
