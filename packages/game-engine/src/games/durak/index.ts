import { createRng } from '../../core/rng';
import { fail, ok, type GameDefinition, type Outcome, type Seat } from '../../core/types';
import { chooseDurakAction } from './ai';

export type Suit = 'S' | 'H' | 'D' | 'C';
export interface Card {
  /** 6..10 — числа, 11 — валет, 12 — дама, 13 — король, 14 — туз. */
  rank: number;
  suit: Suit;
}
export type Variant = 'podkidnoy' | 'perevodnoy';

export interface TablePair {
  attack: Card;
  defense: Card | null;
}

/**
 * Фазы кона:
 *  lead   — атакующий выкладывает первую карту;
 *  defend — защитник бьёт, берёт или (в переводном) переводит;
 *  throw  — подкидывание: остальные игроки добавляют карты ИЛИ пасуют (защитник уже отбился или берёт).
 */
export type Phase = 'lead' | 'defend' | 'throw';

export interface DurakState {
  variant: Variant;
  players: number;
  hands: Card[][];
  /** Колода: берём с конца массива; deck[0] — козырная карта (открыта), её берут последней. */
  deck: Card[];
  trump: Suit;
  discard: number;
  table: TablePair[];
  attacker: Seat;
  defender: Seat;
  phase: Phase;
  /** Защитник сказал «беру»: ему можно докинуть карты, затем он забирает всё со стола. */
  taking: boolean;
  /** Игроки, отказавшиеся подкидывать в текущей фазе. */
  passed: Seat[];
  /** Максимум карт атаки в этом коне. */
  cap: number;
  firstBout: boolean;
  /** Вышедшие из игры (без карт при пустой колоде) в порядке выхода. */
  out: Seat[];
  finished: boolean;
  loser: Seat | null;
}

export type DurakAction =
  | { t: 'play'; card: Card }
  | { t: 'beat'; idx: number; card: Card }
  | { t: 'take' }
  | { t: 'transfer'; card: Card }
  | { t: 'throw'; card: Card }
  | { t: 'pass' };

export interface DurakView {
  variant: Variant;
  players: number;
  /** Моя рука (у наблюдателя пусто). */
  hand: Card[];
  handCounts: number[];
  deckCount: number;
  /** Козырная карта, пока она лежит под колодой. */
  trumpCard: Card | null;
  trump: Suit;
  discard: number;
  table: TablePair[];
  attacker: Seat;
  defender: Seat;
  phase: Phase;
  taking: boolean;
  passed: Seat[];
  cap: number;
  out: Seat[];
  finished: boolean;
  loser: Seat | null;
}

// ───────── карты ─────────

const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
export const cardKey = (c: Card) => `${c.rank}${c.suit}`;
export const sameCard = (a: Card, b: Card) => a.rank === b.rank && a.suit === b.suit;

export function newDeck(): Card[] {
  return SUITS.flatMap((suit) => Array.from({ length: 9 }, (_, i) => ({ rank: 6 + i, suit })));
}

/** Бьёт ли `def` карту `att` при козыре `trump`. */
export function beats(trump: Suit, att: Card, def: Card): boolean {
  if (def.suit === att.suit) return def.rank > att.rank;
  return def.suit === trump && att.suit !== trump;
}

/** Порядок сортировки руки: некозыри по мастям и рангу, козыри в конце. */
export function sortHand(trump: Suit, hand: Card[]): Card[] {
  const w = (c: Card) => (c.suit === trump ? 100 : SUITS.indexOf(c.suit) * 20) + c.rank;
  return [...hand].sort((a, b) => w(a) - w(b));
}

// ───────── вспомогательное ─────────

const inGame = (s: DurakState, seat: Seat) => !s.out.includes(seat);
const activeSeats = (s: DurakState) => Array.from({ length: s.players }, (_, i) => i).filter((i) => inGame(s, i));

/** Следующий (по часовой, т.е. по возрастанию места) игрок, не вышедший из игры. */
function nextActive(s: DurakState, from: Seat): Seat {
  for (let i = 1; i <= s.players; i++) {
    const seat = (from + i) % s.players;
    if (inGame(s, seat)) return seat;
  }
  return from;
}

const tableRanks = (s: DurakState) => new Set(s.table.flatMap((p) => (p.defense ? [p.attack.rank, p.defense.rank] : [p.attack.rank])));
const undefended = (s: DurakState) => s.table.flatMap((p, idx) => (p.defense ? [] : [idx]));

/** Карты, которые `seat` может подкинуть сейчас. */
function throwable(s: DurakState, seat: Seat): Card[] {
  if (s.table.length >= s.cap) return [];
  const ranks = tableRanks(s);
  return s.hands[seat]!.filter((c) => ranks.has(c.rank));
}

function eligibleThrowers(s: DurakState): Seat[] {
  if (s.phase !== 'throw') return [];
  const order = [s.attacker, ...activeSeats(s).filter((x) => x !== s.attacker)];
  return order.filter((x) => x !== s.defender && inGame(s, x) && !s.passed.includes(x) && throwable(s, x).length > 0);
}

function clone(s: DurakState): DurakState {
  return {
    ...s,
    hands: s.hands.map((h) => h.slice()),
    deck: s.deck.slice(),
    table: s.table.map((p) => ({ ...p })),
    passed: s.passed.slice(),
    out: s.out.slice(),
  };
}

const removeCard = (hand: Card[], card: Card) => {
  const i = hand.findIndex((c) => sameCard(c, card));
  if (i >= 0) hand.splice(i, 1);
};

// ───────── ход конов ─────────

/** Завершает кон: забирает/сбрасывает карты, добирает до 6, определяет вышедших и следующие роли. */
function resolveBout(s: DurakState): void {
  const taker = s.taking ? s.defender : null;
  if (taker !== null) {
    for (const p of s.table) s.hands[taker]!.push(p.attack, ...(p.defense ? [p.defense] : []));
  } else {
    s.discard += s.table.reduce((n, p) => n + (p.defense ? 2 : 1), 0);
  }
  s.table = [];

  // Добор: сначала атакующий, затем остальные по кругу, защитник — последним.
  const order = [s.attacker];
  for (let x = nextActive(s, s.attacker); x !== s.attacker; x = nextActive(s, x)) if (x !== s.defender) order.push(x);
  if (s.defender !== s.attacker) order.push(s.defender);
  for (const seat of order) {
    if (!inGame(s, seat)) continue;
    while (s.hands[seat]!.length < 6 && s.deck.length > 0) s.hands[seat]!.push(s.deck.pop() as Card);
  }
  // Кто остался без карт при пустой колоде — выходит.
  if (s.deck.length === 0) {
    for (const seat of order) if (inGame(s, seat) && s.hands[seat]!.length === 0) s.out.push(seat);
  }

  const active = activeSeats(s);
  if (active.length <= 1) {
    s.finished = true;
    s.loser = active[0] ?? null;
    s.phase = 'lead';
    s.passed = [];
    return;
  }

  const prevDefender = s.defender;
  s.attacker = taker !== null ? nextActive(s, prevDefender) : inGame(s, prevDefender) ? prevDefender : nextActive(s, prevDefender);
  s.defender = nextActive(s, s.attacker);
  s.phase = 'lead';
  s.taking = false;
  s.passed = [];
  s.firstBout = false;
  s.cap = Math.min(6, s.hands[s.defender]!.length);
}

/** Автопропуск тех, кому нечего подкинуть, и автозавершение кона, когда подкидывать больше некому. */
function settle(s: DurakState): void {
  if (s.finished || s.phase !== 'throw') return;
  for (const seat of activeSeats(s)) {
    if (seat !== s.defender && !s.passed.includes(seat) && throwable(s, seat).length === 0) s.passed.push(seat);
  }
  if (eligibleThrowers(s).length === 0) resolveBout(s);
}

// ───────── определение игры ─────────

export const durakGame: GameDefinition<DurakState, DurakAction, DurakView, { variant?: Variant }> = {
  slug: 'durak',
  minPlayers: 2,
  maxPlayers: 6,

  setup: ({ players, seed, variant }) => {
    const rng = createRng(seed);
    const deck = rng.shuffle(newDeck());
    const hands: Card[][] = Array.from({ length: players }, () => []);
    for (let round = 0; round < 6; round++) for (let p = 0; p < players; p++) hands[p]!.push(deck.pop() as Card);
    // При 6 игроках колода кончается раздачей — козырем считается масть последней розданной карты.
    const trump: Suit = deck.length > 0 ? deck[0]!.suit : hands[players - 1]![5]!.suit;

    // Первым атакует владелец младшего козыря (если козырей на руках нет — первый игрок).
    let attacker = 0;
    let best = 99;
    hands.forEach((h, seat) => {
      for (const c of h) if (c.suit === trump && c.rank < best) { best = c.rank; attacker = seat; }
    });
    const s: DurakState = {
      variant: variant === 'perevodnoy' ? 'perevodnoy' : 'podkidnoy',
      players, hands, deck, trump, discard: 0, table: [],
      attacker, defender: 0, phase: 'lead', taking: false, passed: [], cap: 0,
      firstBout: true, out: [], finished: false, loser: null,
    };
    s.defender = nextActive(s, attacker);
    s.cap = Math.min(5, s.hands[s.defender]!.length);
    return s;
  },

  currentSeats: (s) => {
    if (s.finished) return [];
    if (s.phase === 'lead') return [s.attacker];
    if (s.phase === 'defend') return [s.defender];
    return eligibleThrowers(s);
  },

  legalActions: (s, seat) => {
    if (s.finished || !durakGame.currentSeats(s).includes(seat)) return [];
    const hand = s.hands[seat]!;
    if (s.phase === 'lead') return hand.map((card) => ({ t: 'play', card }));

    if (s.phase === 'defend') {
      const acts: DurakAction[] = [{ t: 'take' }];
      for (const idx of undefended(s)) for (const card of hand) if (beats(s.trump, s.table[idx]!.attack, card)) acts.push({ t: 'beat', idx, card });
      if (canTransfer(s)) for (const card of hand) if (card.rank === s.table[0]!.attack.rank) acts.push({ t: 'transfer', card });
      return acts;
    }
    return [...throwable(s, seat).map((card): DurakAction => ({ t: 'throw', card })), { t: 'pass' }];
  },

  validate: (s, seat, a) => {
    if (s.finished) return fail('Партия завершена');
    if (!durakGame.currentSeats(s).includes(seat)) return fail('Сейчас не ваш ход');
    const legal = durakGame.legalActions(s, seat);
    return legal.some((x) => sameAction(x, a)) ? ok(undefined) : fail('Так сыграть нельзя');
  },

  apply: (prev, seat, a) => {
    const s = clone(prev);
    const hand = s.hands[seat]!;
    switch (a.t) {
      case 'play':
        removeCard(hand, a.card);
        s.table.push({ attack: a.card, defense: null });
        s.phase = 'defend';
        break;
      case 'beat':
        removeCard(hand, a.card);
        s.table[a.idx]!.defense = a.card;
        if (undefended(s).length === 0) {
          s.phase = 'throw';
          s.passed = [];
        }
        break;
      case 'take':
        s.taking = true;
        s.phase = 'throw';
        s.passed = [];
        break;
      case 'transfer': {
        removeCard(hand, a.card);
        s.table.push({ attack: a.card, defense: null });
        const next = nextActive(s, s.defender);
        s.attacker = s.defender; // перевёл — теперь сам «атакует» (подкидывает) следующему
        s.defender = next;
        s.cap = Math.min(s.firstBout ? 5 : 6, s.hands[next]!.length);
        s.passed = [];
        break;
      }
      case 'throw':
        removeCard(hand, a.card);
        s.table.push({ attack: a.card, defense: null });
        if (!s.taking) {
          s.phase = 'defend';
          s.passed = [];
        }
        break;
      case 'pass':
        s.passed.push(seat);
        break;
    }
    settle(s);
    return s;
  },

  outcome: (s): Outcome | null => {
    if (!s.finished) return null;
    const rest = Array.from({ length: s.players }, (_, i) => i).filter((i) => i !== s.loser && !s.out.includes(i));
    const ranking = [...s.out, ...rest, ...(s.loser !== null ? [s.loser] : [])];
    return {
      winners: s.loser === null ? [] : ranking.filter((x) => x !== s.loser),
      ranking,
      reason: s.loser === null ? 'draw' : 'durak',
    };
  },

  view: (s, seat) => ({
    variant: s.variant,
    players: s.players,
    hand: seat === null ? [] : sortHand(s.trump, s.hands[seat]!),
    handCounts: s.hands.map((h) => h.length),
    deckCount: s.deck.length,
    trumpCard: s.deck[0] ?? null,
    trump: s.trump,
    discard: s.discard,
    table: s.table,
    attacker: s.attacker,
    defender: s.defender,
    phase: s.phase,
    taking: s.taking,
    passed: s.passed,
    cap: s.cap,
    out: s.out,
    finished: s.finished,
    loser: s.loser,
  }),

  timeoutAction: (s, seat) => {
    if (s.phase === 'lead') return { t: 'play', card: sortHand(s.trump, s.hands[seat]!)[0]! };
    if (s.phase === 'defend') return { t: 'take' };
    return { t: 'pass' };
  },

  chooseBotAction: (s, seat, bot) => chooseDurakAction(s, seat, bot),
};

/** Перевод возможен: переводной вариант, ни одна карта ещё не побита, все атакующие карты одного ранга, есть кому переводить. */
export function canTransfer(s: DurakState): boolean {
  if (s.variant !== 'perevodnoy' || s.phase !== 'defend' || s.taking) return false;
  if (s.table.some((p) => p.defense) || s.table.length === 0) return false;
  const rank = s.table[0]!.attack.rank;
  if (!s.table.every((p) => p.attack.rank === rank)) return false;
  if (activeSeats(s).length < 3) return false;
  const next = nextActive(s, s.defender);
  return s.hands[next]!.length >= s.table.length + 1;
}

function sameAction(x: DurakAction, y: unknown): boolean {
  const b = y as Partial<DurakAction> & { card?: Card; idx?: number };
  if (!b || x.t !== b.t) return false;
  if ('card' in x && !(b.card && sameCard(x.card, b.card))) return false;
  if (x.t === 'beat' && x.idx !== b.idx) return false;
  return true;
}
