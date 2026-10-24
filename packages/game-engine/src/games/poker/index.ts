import { createRng } from '../../core/rng';
import { fail, ok, type GameDefinition, type Outcome, type Seat } from '../../core/types';
import { choosePokerAction } from './ai';
import { evaluate, handName } from './eval';

export * from './eval';

/**
 * Техасский Холдем без лимита, формат «сит-энд-гоу»: у всех по 1000 фишек, блайнды растут каждые 8 раздач,
 * играем, пока не останется один игрок. Место в рейтинге — по порядку вылета.
 */
export const START_STACK = 1000;
export const HANDS_PER_LEVEL = 8;
const BLINDS: [number, number][] = [[10, 20], [15, 30], [25, 50], [50, 100], [75, 150], [100, 200], [150, 300], [200, 400], [300, 600], [400, 800], [600, 1200]];
export const blindsFor = (level: number): [number, number] => {
  const b = BLINDS[Math.min(level, BLINDS.length - 1)]!;
  const extra = Math.max(0, level - (BLINDS.length - 1));
  return [b[0] * 2 ** extra, b[1] * 2 ** extra]; // после таблицы блайнды удваиваются — игра гарантированно заканчивается
};

export type Street = 'preflop' | 'flop' | 'turn' | 'river';

export interface HandSummary {
  handNo: number;
  board: number[];
  pots: { amount: number; winners: Seat[]; hand: string | null }[];
  /** Открытые карты участников вскрытия (если вскрытие было). */
  revealed: Record<number, number[]>;
  /** Итоговый выигрыш/проигрыш по местам за раздачу. */
  delta: number[];
}

export interface PokerState {
  players: number;
  stacks: number[];
  hole: number[][];
  board: number[];
  deck: number[];
  dealer: Seat;
  handNo: number;
  level: number;
  bets: number[];
  committed: number[];
  folded: boolean[];
  allIn: boolean[];
  out: boolean[];
  bustOrder: Seat[];
  street: Street;
  toAct: Seat | null;
  currentBet: number;
  minRaise: number;
  acted: boolean[];
  rng: number;
  lastHand: HandSummary | null;
  finished: boolean;
  winner: Seat | null;
}

export type PokerAction =
  | { t: 'fold' }
  | { t: 'check' }
  | { t: 'call' }
  /** `to` — общий размер ставки игрока на этой улице после рейза. */
  | { t: 'raise'; to: number };

export interface PokerView {
  players: number;
  stacks: number[];
  hole: number[];
  board: number[];
  dealer: Seat;
  handNo: number;
  blinds: [number, number];
  bets: number[];
  folded: boolean[];
  allIn: boolean[];
  out: boolean[];
  street: Street;
  toAct: Seat | null;
  currentBet: number;
  minRaiseTo: number;
  pot: number;
  lastHand: HandSummary | null;
  bustOrder: Seat[];
  finished: boolean;
  winner: Seat | null;
}

const clone = (s: PokerState): PokerState => JSON.parse(JSON.stringify(s)) as PokerState;
const seatsIn = (s: PokerState) => Array.from({ length: s.players }, (_, i) => i).filter((i) => !s.out[i]);
const nextIn = (s: PokerState, from: Seat): Seat => {
  for (let i = 1; i <= s.players; i++) {
    const seat = (from + i) % s.players;
    if (!s.out[seat]) return seat;
  }
  return from;
};
const live = (s: PokerState) => seatsIn(s).filter((i) => !s.folded[i]);
const potOf = (s: PokerState) => s.committed.reduce((a, b) => a + b, 0);

// ───────── раздача ─────────

function startHand(s: PokerState) {
  const rng = createRng(s.rng);
  s.handNo++;
  s.level = Math.floor((s.handNo - 1) / HANDS_PER_LEVEL);
  const [sb, bb] = blindsFor(s.level);
  s.deck = rng.shuffle(Array.from({ length: 52 }, (_, i) => i));
  s.rng = rng.state;
  s.board = [];
  s.street = 'preflop';
  s.hole = Array.from({ length: s.players }, () => []);
  s.bets = Array(s.players).fill(0);
  s.committed = Array(s.players).fill(0);
  s.folded = Array.from({ length: s.players }, (_, i) => s.out[i]!);
  s.allIn = Array(s.players).fill(false);
  s.acted = Array(s.players).fill(false);

  const active = seatsIn(s);
  s.dealer = s.handNo === 1 ? active[0]! : nextIn(s, s.dealer);
  // Вдвоём кнопка = малый блайнд и ходит первой до флопа.
  const sbSeat = active.length === 2 ? s.dealer : nextIn(s, s.dealer);
  const bbSeat = nextIn(s, sbSeat);

  for (const seat of active) s.hole[seat] = [s.deck.pop() as number, s.deck.pop() as number];
  const post = (seat: Seat, amount: number) => {
    const pay = Math.min(amount, s.stacks[seat]!);
    s.stacks[seat]! -= pay;
    s.bets[seat]! += pay;
    s.committed[seat]! += pay;
    if (s.stacks[seat] === 0) s.allIn[seat] = true;
  };
  post(sbSeat, sb);
  post(bbSeat, bb);
  s.currentBet = Math.max(s.bets[sbSeat]!, s.bets[bbSeat]!);
  s.minRaise = bb;
  s.toAct = nextActor(s, bbSeat);
  if (s.toAct === null) advanceStreet(s); // все в олл-ине уже на блайндах
}

/** Ближайший по кругу игрок, которому ещё нужно действовать. */
function nextActor(s: PokerState, from: Seat): Seat | null {
  for (let i = 1; i <= s.players; i++) {
    const seat = (from + i) % s.players;
    if (s.folded[seat] || s.allIn[seat] || s.out[seat]) continue;
    if (!s.acted[seat] || s.bets[seat]! < s.currentBet) return seat;
  }
  return null;
}

function advanceStreet(s: PokerState) {
  for (;;) {
    if (s.street === 'river') return showdown(s);
    s.street = s.street === 'preflop' ? 'flop' : s.street === 'flop' ? 'turn' : 'river';
    s.deck.pop(); // сжигаемая карта
    const n = s.street === 'flop' ? 3 : 1;
    for (let i = 0; i < n; i++) s.board.push(s.deck.pop() as number);
    s.bets = Array(s.players).fill(0);
    s.currentBet = 0;
    s.minRaise = blindsFor(s.level)[1];
    s.acted = Array(s.players).fill(false);
    const canAct = live(s).filter((i) => !s.allIn[i]);
    if (canAct.length >= 2) {
      s.toAct = nextActor(s, s.dealer);
      return;
    }
    // Ставить некому (остальные в олл-ине) — карты открываются до конца.
  }
}

/** Возвращает непокрытую часть самой большой ставки её владельцу. */
function returnUncalled(s: PokerState) {
  const order = Array.from({ length: s.players }, (_, i) => i).sort((a, b) => s.committed[b]! - s.committed[a]!);
  const top = order[0]!;
  const second = s.committed[order[1]!]!;
  const excess = s.committed[top]! - second;
  if (excess > 0 && !s.folded[top]) {
    s.committed[top]! -= excess;
    s.stacks[top]! += excess;
  }
}

function showdown(s: PokerState) {
  returnUncalled(s);
  const contenders = live(s);
  const revealed: Record<number, number[]> = {};
  const value = new Map<Seat, number>();
  if (contenders.length > 1) {
    for (const seat of contenders) {
      revealed[seat] = s.hole[seat]!;
      value.set(seat, evaluate([...s.hole[seat]!, ...s.board]));
    }
  }
  const before = s.stacks.map((x, i) => x + s.committed[i]!);
  const levels = [...new Set(contenders.map((c) => s.committed[c]!))].sort((a, b) => a - b);
  let prev = 0;
  const pots: HandSummary['pots'] = [];
  for (const level of levels) {
    let amount = 0;
    for (let i = 0; i < s.players; i++) amount += Math.max(0, Math.min(s.committed[i]!, level) - Math.min(s.committed[i]!, prev));
    const eligible = contenders.filter((c) => s.committed[c]! >= level);
    prev = level;
    if (amount === 0) continue;
    let winners = eligible;
    if (contenders.length > 1) {
      const best = Math.max(...eligible.map((e) => value.get(e)!));
      winners = eligible.filter((e) => value.get(e) === best);
    }
    const share = Math.floor(amount / winners.length);
    let rest = amount - share * winners.length;
    // Лишние фишки — первому победителю слева от кнопки.
    const ordered = [...winners].sort((a, b) => ((a - s.dealer - 1 + s.players) % s.players) - ((b - s.dealer - 1 + s.players) % s.players));
    for (const w of ordered) {
      s.stacks[w]! += share + (rest > 0 ? 1 : 0);
      if (rest > 0) rest--;
    }
    pots.push({ amount, winners: ordered, hand: contenders.length > 1 ? handName(value.get(ordered[0]!)!) : null });
  }
  // Все ставки старше последнего уровня победителей (фишки сбросивших выше) уже учтены через min(); остаток нулевой.
  const delta = s.stacks.map((x, i) => x - before[i]!);
  s.lastHand = { handNo: s.handNo, board: [...s.board], pots, revealed, delta };
  s.committed = Array(s.players).fill(0);
  s.bets = Array(s.players).fill(0);
  endHand(s);
}

function awardUncontested(s: PokerState) {
  returnUncalled(s);
  const winner = live(s)[0] as Seat;
  const pot = potOf(s);
  const before = s.stacks.map((x, i) => x + s.committed[i]!);
  s.stacks[winner]! += pot;
  s.lastHand = { handNo: s.handNo, board: [...s.board], pots: [{ amount: pot, winners: [winner], hand: null }], revealed: {}, delta: s.stacks.map((x, i) => x - before[i]!) };
  s.committed = Array(s.players).fill(0);
  s.bets = Array(s.players).fill(0);
  endHand(s);
}

function endHand(s: PokerState) {
  s.toAct = null;
  // Вылетевшие: сначала те, у кого фишек (до раздачи) было меньше.
  const busted = seatsIn(s).filter((i) => s.stacks[i] === 0).sort((a, b) => (s.lastHand!.delta[b]! - s.lastHand!.delta[a]!) || a - b);
  for (const seat of busted) {
    s.out[seat] = true;
    s.bustOrder.push(seat);
  }
  const left = seatsIn(s);
  if (left.length <= 1) {
    s.finished = true;
    s.winner = left[0] ?? null;
    return;
  }
  startHand(s);
}

// ───────── правила ходов ─────────

const toCall = (s: PokerState, seat: Seat) => Math.min(s.currentBet - s.bets[seat]!, s.stacks[seat]!);
export const minRaiseTo = (s: PokerState) => s.currentBet + s.minRaise;

export function raiseOptions(s: PokerState, seat: Seat): number[] {
  const maxTo = s.bets[seat]! + s.stacks[seat]!;
  if (maxTo <= s.currentBet) return [];
  const minTo = Math.min(minRaiseTo(s), maxTo);
  const pot = potOf(s);
  const raw = [minTo, s.currentBet + Math.round(pot / 2), s.currentBet + pot, s.currentBet + pot * 2, maxTo];
  return [...new Set(raw.map((x) => Math.max(minTo, Math.min(x, maxTo))))].sort((a, b) => a - b);
}

export const pokerGame: GameDefinition<PokerState, PokerAction, PokerView> = {
  slug: 'poker',
  minPlayers: 2,
  maxPlayers: 9,

  setup: ({ players, seed }) => {
    const rng = createRng(seed);
    const s: PokerState = {
      players, stacks: Array(players).fill(START_STACK), hole: [], board: [], deck: [], dealer: 0, handNo: 0, level: 0,
      bets: [], committed: [], folded: [], allIn: [], out: Array(players).fill(false), bustOrder: [],
      street: 'preflop', toAct: null, currentBet: 0, minRaise: 0, acted: [], rng: rng.state,
      lastHand: null, finished: false, winner: null,
    };
    startHand(s);
    return s;
  },

  currentSeats: (s) => (s.finished || s.toAct === null ? [] : [s.toAct]),

  legalActions: (s, seat) => {
    if (s.finished || s.toAct !== seat) return [];
    const acts: PokerAction[] = [{ t: 'fold' }];
    acts.push(toCall(s, seat) === 0 ? { t: 'check' } : { t: 'call' });
    // Если после колла фишек не остаётся, рейзить нельзя.
    if (s.stacks[seat]! > s.currentBet - s.bets[seat]!) for (const to of raiseOptions(s, seat)) acts.push({ t: 'raise', to });
    return acts;
  },

  validate: (s, seat, a) => {
    if (s.finished) return fail('Партия завершена');
    if (s.toAct !== seat) return fail('Сейчас не ваш ход');
    const act = a as PokerAction | null;
    if (!act || typeof act !== 'object') return fail('Некорректное действие');
    switch (act.t) {
      case 'fold': return ok(undefined);
      case 'check': return toCall(s, seat) === 0 ? ok(undefined) : fail('Нельзя проверить — нужно уравнять ставку');
      case 'call': return toCall(s, seat) > 0 ? ok(undefined) : fail('Уравнивать нечего — можно проверить');
      case 'raise': {
        if (!Number.isInteger(act.to)) return fail('Некорректная ставка');
        const maxTo = s.bets[seat]! + s.stacks[seat]!;
        if (maxTo <= s.currentBet) return fail('Недостаточно фишек для рейза');
        if (act.to > maxTo) return fail('Больше, чем у вас есть');
        if (act.to <= s.currentBet) return fail('Рейз должен быть больше текущей ставки');
        // Меньше минимального можно только олл-ином.
        if (act.to < minRaiseTo(s) && act.to !== maxTo) return fail(`Минимальный рейз — до ${minRaiseTo(s)}`);
        return ok(undefined);
      }
      default: return fail('Неизвестное действие');
    }
  },

  apply: (prev, seat, a) => {
    const s = clone(prev);
    const pay = (amount: number) => {
      s.stacks[seat]! -= amount;
      s.bets[seat]! += amount;
      s.committed[seat]! += amount;
      if (s.stacks[seat] === 0) s.allIn[seat] = true;
    };
    switch (a.t) {
      case 'fold':
        s.folded[seat] = true;
        break;
      case 'check':
        s.acted[seat] = true;
        break;
      case 'call':
        pay(toCall(s, seat));
        s.acted[seat] = true;
        break;
      case 'raise': {
        const size = a.to - s.currentBet;
        pay(a.to - s.bets[seat]!);
        if (size >= s.minRaise) {
          // Полный рейз: пересматриваем действия остальных.
          s.minRaise = size;
          s.acted = Array(s.players).fill(false);
        }
        // Короткий олл-ин поднимает ставку, но торги для уже походивших не переоткрывает.
        s.currentBet = a.to;
        s.acted[seat] = true;
        break;
      }
    }
    if (live(s).length === 1) {
      awardUncontested(s);
      return s;
    }
    const nxt = nextActor(s, seat);
    if (nxt !== null) s.toAct = nxt;
    else advanceStreet(s);
    return s;
  },

  outcome: (s): Outcome | null => {
    if (!s.finished) return null;
    const winner = s.winner as Seat;
    const ranking = [winner, ...[...s.bustOrder].reverse()];
    return { winners: [winner], ranking, reason: 'allchips' };
  },

  view: (s, seat) => ({
    players: s.players, stacks: s.stacks, hole: seat === null ? [] : (s.hole[seat] ?? []), board: s.board, dealer: s.dealer,
    handNo: s.handNo, blinds: blindsFor(s.level), bets: s.bets, folded: s.folded, allIn: s.allIn, out: s.out, street: s.street,
    toAct: s.toAct, currentBet: s.currentBet, minRaiseTo: minRaiseTo(s), pot: potOf(s) , lastHand: s.lastHand,
    bustOrder: s.bustOrder, finished: s.finished, winner: s.winner,
  }),

  timeoutAction: (s, seat) => (toCall(s, seat) === 0 ? { t: 'check' } : { t: 'fold' }),

  chooseBotAction: (s, seat, bot) => choosePokerAction(s, seat, bot),
};

export { potOf, live, toCall };
