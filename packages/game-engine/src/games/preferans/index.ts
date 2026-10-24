import { createRng } from '../../core/rng';
import { fail, ok, type BotContext, type GameDefinition, type Outcome, type Result, type Seat } from '../../core/types';

/**
 * Преферанс (спортивный/сочинский вариант), 3 игрока, колода 32 карты (7…туз).
 *
 * Раздача: по 10 карт и прикуп из 2 карт. Торговля идёт по старшинству заявок: 6♠ < 6♣ < 6♦ < 6♥ < 6БК < 7♠ … 7БК <
 * МИЗЕР < 8♠ … 10БК. Взявший торговлю забирает прикуп, сбрасывает две карты и называет игру (не ниже заявки).
 * Вистующие после этого говорят «вист» или «пас». Если один вистует, а другой пасует, карты пасующего открываются,
 * и вистующий играет за обоих. Если пасуют оба — игра засчитывается без розыгрыша.
 * Если все спасовали — «распасы»: игра без козыря, каждая взятка — гора.
 * Запись: пуля, гора и висты — «Сочи» (цена игры 6→2, 7→4, 8→6, 9→8, 10→10, мизер — 10).
 * Матч — несколько раздач (по умолчанию 6); итог — баланс: взаимные висты + 10 × (пуля − средняя пуля).
 */
export const SUITS = ['♠', '♣', '♦', '♥'] as const;
export const RANKS = ['7', '8', '9', '10', 'В', 'Д', 'К', 'Т'] as const;
export const NT = 4;
export const MISERE_ID = 10;
export const MAX_BID = 25;

export const suitOf = (c: number) => Math.floor(c / 8);
export const rankOf = (c: number) => c % 8;
export const cardName = (c: number) => `${RANKS[rankOf(c)]}${SUITS[suitOf(c)]}`;

export type ContractInfo = { kind: 'suit'; level: number; suit: number } | { kind: 'misere' };
/** Номер заявки в порядке старшинства (0…25) → игра. */
export function contractOf(id: number): ContractInfo {
  if (id === MISERE_ID) return { kind: 'misere' };
  if (id < MISERE_ID) return { kind: 'suit', level: 6 + Math.floor(id / 5), suit: id % 5 };
  return { kind: 'suit', level: 8 + Math.floor((id - 11) / 5), suit: (id - 11) % 5 };
}
export const contractId = (level: number, suit: number) => (level <= 7 ? (level - 6) * 5 + suit : 11 + (level - 8) * 5 + suit);
export const contractName = (id: number) => {
  const c = contractOf(id);
  return c.kind === 'misere' ? 'мизер' : `${c.level}${c.suit === NT ? ' БК' : SUITS[c.suit]}`;
};
/** Цена игры: очки пули и цена виста/горы. */
export const priceOf = (id: number) => {
  const c = contractOf(id);
  return c.kind === 'misere' ? 10 : (c.level - 5) * 2;
};
const trumpOf = (id: number | null) => {
  if (id === null) return -1;
  const c = contractOf(id);
  return c.kind === 'suit' && c.suit < NT ? c.suit : -1;
};

export type Phase = 'bid' | 'discard' | 'declare' | 'whist' | 'play' | 'over';

export interface PrefState {
  deals: number;
  dealNo: number;
  dealer: Seat;
  rng: number;
  hands: number[][];
  talon: number[];
  phase: Phase;
  bidTurn: Seat;
  passed: boolean[];
  /** Последняя заявка каждого игрока (для показа): номер заявки, −1 — пас, null — ещё не торговался. */
  lastBid: (number | null)[];
  highRank: number;
  highBidder: Seat;
  declarer: Seat;
  /** Названная игра; null — распасы (или торговля ещё идёт). */
  contract: number | null;
  allPass: boolean;
  whist: (boolean | null)[];
  whistTurn: Seat;
  /** Пасующий вистующему: его карты открыты. */
  openHand: Seat;
  trick: { seat: Seat; card: number }[];
  turn: Seat;
  tricks: number[];
  pula: number[];
  gora: number[];
  /** whists[i][j] — висты, записанные игроком i на игрока j. */
  whists: number[][];
  log: string[];
  /** Итог матча: баланс каждого игрока. */
  balance: number[] | null;
}

export type PrefAction =
  | { t: 'bid'; id: number }
  | { t: 'pass' }
  | { t: 'discard'; cards: number[] }
  | { t: 'declare'; id: number }
  | { t: 'whist'; yes: boolean }
  | { t: 'play'; card: number; for?: Seat };

export interface PrefView extends Omit<PrefState, 'hands' | 'talon' | 'rng'> {
  /** Видимые руки: свои, открытая рука пасующего, у остальных — null. */
  hands: (number[] | null)[];
  handCounts: number[];
  talonCount: number;
  finished: boolean;
  /** Кто ходит картами сейчас (с учётом открытой руки). */
  controller: Seat | null;
  /** Предварительный баланс по текущим записям. */
  standing: number[];
}

const clone = (s: PrefState): PrefState => JSON.parse(JSON.stringify(s)) as PrefState;
const name = (seat: Seat) => `Игрок ${seat + 1}`;
const log = (s: PrefState, t: string) => {
  s.log.push(t);
  if (s.log.length > 14) s.log.shift();
};
const sortHand = (h: number[]) => h.sort((a, b) => a - b);
const nextSeat = (x: Seat) => (x + 1) % 3;

// ───────── правила розыгрыша ─────────

function trumpOfState(s: PrefState) {
  return s.allPass ? -1 : trumpOf(s.contract);
}
const whisters = (s: PrefState) => [0, 1, 2].filter((p) => s.whist[p] === true);

/** Кто сейчас играет картами за место `seat` (вистующий играет и за пасующего). */
function controllerOf(s: PrefState, seat: Seat): Seat {
  if (s.openHand === seat) return whisters(s)[0]!;
  return seat;
}

function playable(s: PrefState, hand: number[]): number[] {
  if (s.trick.length === 0) return hand;
  const lead = suitOf(s.trick[0]!.card);
  const follow = hand.filter((c) => suitOf(c) === lead);
  if (follow.length) return follow;
  const tr = trumpOfState(s);
  if (tr >= 0) {
    const t = hand.filter((c) => suitOf(c) === tr);
    if (t.length) return t;
  }
  return hand;
}

/** Бьёт ли карта `a` карту `b` в текущей взятке. */
function beats(a: number, b: number, lead: number, trump: number): boolean {
  const sa = suitOf(a);
  const sb = suitOf(b);
  if (sa === sb) return rankOf(a) > rankOf(b);
  if (trump >= 0 && sa === trump) return true;
  if (trump >= 0 && sb === trump) return false;
  return sa === lead && sb !== lead;
}

function trickWinner(s: PrefState): Seat {
  const lead = suitOf(s.trick[0]!.card);
  const tr = trumpOfState(s);
  let best = s.trick[0]!;
  for (const p of s.trick.slice(1)) if (beats(p.card, best.card, lead, tr)) best = p;
  return best.seat;
}

// ───────── раздача и запись ─────────

function startDeal(s: PrefState) {
  const rng = createRng(s.rng);
  const deck = rng.shuffle(Array.from({ length: 32 }, (_, i) => i));
  s.rng = rng.state;
  s.hands = [0, 1, 2].map((p) => sortHand(deck.slice(p * 10, p * 10 + 10)));
  s.talon = deck.slice(30, 32);
  s.dealer = s.dealNo % 3;
  s.phase = 'bid';
  s.bidTurn = nextSeat(s.dealer);
  s.passed = [false, false, false];
  s.lastBid = [null, null, null];
  s.highRank = -1;
  s.highBidder = -1;
  s.declarer = -1;
  s.contract = null;
  s.allPass = false;
  s.whist = [null, null, null];
  s.whistTurn = -1;
  s.openHand = -1;
  s.trick = [];
  s.tricks = [0, 0, 0];
  log(s, `Раздача ${s.dealNo + 1} из ${s.deals}. Сдаёт ${name(s.dealer)}, торговлю начинает ${name(s.bidTurn)}.`);
}

/** Запись по итогам раздачи. `played` — разыгрывались ли взятки. */
function settle(s: PrefState, played: boolean) {
  if (s.allPass) {
    for (let p = 0; p < 3; p++) s.gora[p]! += s.tricks[p]!;
    log(s, `Распасы: взятки ${s.tricks.join(' / ')} записаны в гору.`);
  } else {
    const c = contractOf(s.contract!);
    const d = s.declarer;
    const price = priceOf(s.contract!);
    if (c.kind === 'misere') {
      if (s.tricks[d] === 0) {
        s.pula[d]! += 10;
        log(s, `${name(d)} сыграл мизер: +10 в пулю.`);
      } else {
        s.gora[d]! += 10 * s.tricks[d]!;
        log(s, `${name(d)} не вышел из мизера: ${s.tricks[d]} взяток, гора +${10 * s.tricks[d]!}.`);
      }
    } else {
      const need = c.level;
      const got = played ? s.tricks[d]! : need;
      if (got >= need) {
        s.pula[d]! += price;
        log(s, `${name(d)} выполнил ${contractName(s.contract!)}: +${price} в пулю.`);
      } else {
        s.gora[d]! += price * (need - got);
        log(s, `${name(d)} не добрал ${need - got} взятк.: гора +${price * (need - got)}.`);
      }
      if (played) {
        const ws = whisters(s);
        const defenders = [0, 1, 2].filter((p) => p !== d);
        const defTotal = defenders.reduce((a, p) => a + s.tricks[p]!, 0);
        for (const w of ws) {
          // вистующий записывает и взятки пасующего партнёра
          const t = s.tricks[w]! + (ws.length === 1 ? s.tricks[defenders.find((p) => p !== w)!]! : 0);
          s.whists[w]![d]! += price * t;
        }
        const req = 10 - need;
        if (ws.length > 0 && defTotal < req) {
          const lack = (req - defTotal) * price;
          for (const w of ws) s.gora[w]! += lack / ws.length;
          log(s, `Вистующие не добрали ${req - defTotal} взятк.: гора +${lack}.`);
        }
      }
    }
  }
  s.dealNo++;
  if (s.dealNo >= s.deals) {
    s.phase = 'over';
    s.balance = balanceOf(s);
    log(s, 'Матч окончен: итоговый расчёт.');
  } else startDeal(s);
}

/** Итоговый баланс: гора делится между соперниками в висты, пуля — по 10 за очко относительно средней. */
function balanceOf(s: PrefState): number[] {
  const w = s.whists.map((r) => [...r]);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (i !== j) w[j]![i]! += s.gora[i]! / 2;
  const mean = (s.pula[0]! + s.pula[1]! + s.pula[2]!) / 3;
  return [0, 1, 2].map((i) => {
    let b = 10 * (s.pula[i]! - mean);
    for (let j = 0; j < 3; j++) if (j !== i) b += w[i]![j]! - w[j]![i]!;
    return Math.round(b * 10) / 10;
  });
}

function finishBidding(s: PrefState) {
  if (s.highBidder < 0) {
    // Все спасовали — распасы
    s.allPass = true;
    s.talon = [];
    s.phase = 'play';
    s.turn = nextSeat(s.dealer);
    log(s, 'Все спасовали: распасы.');
    return;
  }
  s.declarer = s.highBidder;
  s.hands[s.declarer] = sortHand([...s.hands[s.declarer]!, ...s.talon]);
  s.talon = [];
  s.phase = 'discard';
  log(s, `${name(s.declarer)} выигрывает торговлю: ${contractName(s.highRank)}. Он берёт прикуп.`);
}

function beginPlay(s: PrefState) {
  s.phase = 'play';
  s.turn = s.declarer;
  s.trick = [];
}

// ───────── определение игры ─────────

export const prefGame: GameDefinition<PrefState, PrefAction, PrefView> = {
  slug: 'preferans',
  minPlayers: 3,
  maxPlayers: 3,

  setup: ({ seed, variant }) => {
    const deals = Math.max(1, Math.min(12, Number(variant) || 6));
    const s: PrefState = {
      deals,
      dealNo: 0,
      dealer: 0,
      rng: createRng(seed).state,
      hands: [],
      talon: [],
      phase: 'bid',
      bidTurn: 1,
      passed: [false, false, false],
      lastBid: [null, null, null],
      highRank: -1,
      highBidder: -1,
      declarer: -1,
      contract: null,
      allPass: false,
      whist: [null, null, null],
      whistTurn: -1,
      openHand: -1,
      trick: [],
      turn: 1,
      tricks: [0, 0, 0],
      pula: [0, 0, 0],
      gora: [0, 0, 0],
      whists: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
      log: [],
      balance: null,
    };
    startDeal(s);
    return s;
  },

  currentSeats: (s) => {
    switch (s.phase) {
      case 'bid': return [s.bidTurn];
      case 'discard':
      case 'declare': return [s.declarer];
      case 'whist': return [s.whistTurn];
      case 'play': return [controllerOf(s, s.turn)];
      default: return [];
    }
  },

  legalActions: (s, seat) => {
    const out: PrefAction[] = [];
    switch (s.phase) {
      case 'bid':
        if (seat !== s.bidTurn) return out;
        out.push({ t: 'pass' });
        for (let id = s.highRank + 1; id <= MAX_BID; id++) out.push({ t: 'bid', id });
        return out;
      case 'discard': {
        if (seat !== s.declarer) return out;
        const h = s.hands[seat]!;
        for (let i = 0; i < h.length; i++) for (let j = i + 1; j < h.length; j++) out.push({ t: 'discard', cards: [h[i]!, h[j]!] });
        return out;
      }
      case 'declare':
        if (seat !== s.declarer) return out;
        for (let id = s.highRank; id <= MAX_BID; id++) out.push({ t: 'declare', id });
        return out;
      case 'whist':
        if (seat !== s.whistTurn) return out;
        return [{ t: 'whist', yes: true }, { t: 'whist', yes: false }];
      case 'play': {
        if (controllerOf(s, s.turn) !== seat) return out;
        for (const card of playable(s, s.hands[s.turn]!)) out.push(s.turn === seat ? { t: 'play', card } : { t: 'play', card, for: s.turn });
        return out;
      }
      default:
        return out;
    }
  },

  validate: (s, seat, a): Result => {
    if (s.phase === 'over') return fail('Матч окончен');
    if (!prefGame.currentSeats(s).includes(seat)) return fail('Сейчас не ваш ход');
    if (a.t === 'discard') {
      if (s.phase !== 'discard') return fail('Сейчас не время сбрасывать');
      const [x, y] = a.cards;
      const h = s.hands[seat]!;
      if (a.cards.length !== 2 || x === y || !h.includes(x!) || !h.includes(y!)) return fail('Выберите две разные карты из руки');
      return ok(undefined);
    }
    const legal = prefGame.legalActions(s, seat);
    return legal.some((x) => JSON.stringify(x) === JSON.stringify(a)) ? ok(undefined) : fail('Недопустимое действие');
  },

  apply: (prev, seat, a) => {
    const s = clone(prev);
    switch (a.t) {
      case 'pass':
      case 'bid': {
        if (a.t === 'bid') {
          s.highRank = a.id;
          s.highBidder = seat;
          s.lastBid[seat] = a.id;
          log(s, `${name(seat)}: ${contractName(a.id)}.`);
        } else {
          s.passed[seat] = true;
          s.lastBid[seat] = -1;
          log(s, `${name(seat)}: пас.`);
        }
        const active = [0, 1, 2].filter((p) => !s.passed[p]);
        if (active.length === 0) finishBidding(s);
        else if (active.length === 1 && s.highBidder >= 0) finishBidding(s);
        else {
          let n = nextSeat(seat);
          while (s.passed[n]) n = nextSeat(n);
          s.bidTurn = n;
        }
        break;
      }
      case 'discard': {
        s.hands[seat] = s.hands[seat]!.filter((c) => !a.cards.includes(c));
        s.phase = 'declare';
        break;
      }
      case 'declare': {
        s.contract = a.id;
        log(s, `${name(seat)} заказывает ${contractName(a.id)}.`);
        if (contractOf(a.id).kind === 'misere') beginPlay(s);
        else {
          s.phase = 'whist';
          s.whistTurn = nextSeat(seat);
        }
        break;
      }
      case 'whist': {
        s.whist[seat] = a.yes;
        log(s, `${name(seat)}: ${a.yes ? 'вист' : 'пас'}.`);
        if (seat === nextSeat(s.declarer)) {
          s.whistTurn = nextSeat(seat);
          break;
        }
        const ws = whisters(s);
        if (ws.length === 0) {
          log(s, 'Оба соперника спасовали: игра засчитана без розыгрыша.');
          settle(s, false);
        } else {
          if (ws.length === 1) {
            s.openHand = [0, 1, 2].find((p) => p !== s.declarer && p !== ws[0])!;
            log(s, `${name(s.openHand)} открывает карты, ${name(ws[0]!)} играет за двоих.`);
          }
          beginPlay(s);
        }
        break;
      }
      case 'play': {
        const t = s.turn;
        s.hands[t] = s.hands[t]!.filter((c) => c !== a.card);
        s.trick.push({ seat: t, card: a.card });
        if (s.trick.length < 3) {
          s.turn = nextSeat(t);
          break;
        }
        const w = trickWinner(s);
        s.tricks[w]!++;
        s.trick = [];
        s.turn = w;
        if (s.hands[0]!.length === 0) settle(s, true);
        break;
      }
    }
    return s;
  },

  outcome: (s): Outcome | null => {
    if (s.phase !== 'over' || !s.balance) return null;
    const order = [0, 1, 2].sort((x, y) => s.balance![y]! - s.balance![x]! || x - y);
    const best = s.balance[order[0]!]!;
    return {
      winners: order.filter((i) => s.balance![i] === best),
      ranking: order,
      reason: 'points',
      scores: Object.fromEntries(s.balance.map((v, i) => [i, v])),
    };
  },

  view: (s, seat) => {
    const { hands, talon, rng: _r, ...pub } = s;
    const over = s.phase === 'over';
    return {
      ...pub,
      hands: hands.map((h, p) => (seat === p || (s.openHand === p && s.phase === 'play') ? h : null)),
      handCounts: hands.map((h) => h.length),
      talonCount: talon.length,
      finished: over,
      controller: over || s.phase !== 'play' ? null : controllerOf(s, s.turn),
      standing: balanceOf(s),
    };
  },

  timeoutAction: (s, seat) => {
    const l = prefGame.legalActions(s, seat);
    if (s.phase === 'bid') return { t: 'pass' };
    if (s.phase === 'whist') return { t: 'whist', yes: false };
    if (s.phase === 'declare') return { t: 'declare', id: s.highRank };
    if (s.phase === 'discard') return l[0] ?? null;
    return chooseBot(s, seat, { level: 'EASY', rngSeed: `to-${s.dealNo}-${s.log.length}` });
  },

  chooseBotAction: (s, seat, bot) => chooseBot(s, seat, bot),
};

// ───────── бот ─────────

/** Оценка числа взяток руки при заданном козыре (−1 — без козыря). */
export function estimateTricks(hand: number[], trump: number): number {
  let sum = 0;
  const trumpLen = trump >= 0 ? hand.filter((c) => suitOf(c) === trump).length : 0;
  for (let su = 0; su < 4; su++) {
    const cards = hand.filter((c) => suitOf(c) === su).map(rankOf).sort((a, b) => b - a);
    const L = cards.length;
    if (L === 0) continue;
    const has = (r: number) => cards.includes(r);
    if (su === trump) {
      sum += (has(7) ? 1 : 0) + (has(6) ? (L >= 2 ? 0.9 : 0.4) : 0) + (has(5) ? (L >= 3 ? 0.6 : 0.2) : 0) + (has(4) && L >= 4 ? 0.3 : 0) + Math.max(0, L - 3) * 0.8;
    } else {
      sum += (has(7) ? 1 : 0) + (has(6) ? (L >= 2 ? 0.7 : 0.25) : 0) + (has(5) ? (L >= 3 ? 0.35 : 0.1) : 0);
      if (trump < 0) {
        // длинная старшая масть без козыря
        if (has(7) && has(6) && L >= 4) sum += L - 3 + (has(5) ? 0.5 : 0);
      } else if (L <= 2 && trumpLen >= 2) sum += (3 - L) * 0.3;
    }
  }
  return sum;
}
const bestTrump = (hand: number[]) => {
  let best = { trump: NT, v: -1 };
  for (let t = 0; t <= NT; t++) {
    const v = estimateTricks(hand, t === NT ? -1 : t);
    if (v > best.v) best = { trump: t, v };
  }
  return best;
};
/** Опасность руки для мизера: чем меньше, тем безопаснее. */
function misereDanger(hand: number[]): number {
  let d = 0;
  for (let su = 0; su < 4; su++) {
    const cards = hand.filter((c) => suitOf(c) === su).map(rankOf).sort((a, b) => a - b);
    // карта опасна, если под ней меньше низких карт той же масти, чем нужно «прикрыть»
    cards.forEach((r, i) => {
      if (r >= 4) d += (r - 3) * (i < r - 3 ? 1 : 0.5) * 0.9;
      if (r >= 6 && i === 0) d += 1.5; // голые К/Т
    });
    if (cards.length >= 5) d += cards.length - 4;
  }
  return d;
}

function chooseBot(s: PrefState, seat: Seat, bot: BotContext): PrefAction {
  const rng = createRng(bot.rngSeed);
  const legal = prefGame.legalActions(s, seat);
  const noise = bot.level === 'EASY' ? 1.2 : bot.level === 'MEDIUM' ? 0.5 : bot.level === 'HARD' ? 0.15 : 0;
  const easy = bot.level === 'EASY';
  const hand = s.hands[seat]!;

  switch (s.phase) {
    case 'bid': {
      const { v } = bestTrump(hand);
      const cap = Math.floor(v + 0.9 + (rng.next() - 0.5) * noise);
      const options: number[] = [];
      for (let id = s.highRank + 1; id <= MAX_BID; id++) {
        const c = contractOf(id);
        if (c.kind === 'misere') {
          if (misereDanger(hand) < (easy ? 5 : 2.6)) options.push(id);
          continue;
        }
        const est = estimateTricks(hand, c.suit === NT ? -1 : c.suit) + 0.9;
        if (c.level <= cap && est >= c.level - 0.2) options.push(id);
      }
      if (options.length === 0) return { t: 'pass' };
      return { t: 'bid', id: options[0]! };
    }
    case 'discard': {
      const bid = contractOf(s.highRank);
      const trump = bid.kind === 'suit' && bid.suit < NT ? bid.suit : -1;
      let best = legal[0]!;
      let bv = -1e9;
      for (const a of legal) {
        if (a.t !== 'discard') continue;
        const rest = hand.filter((c) => !a.cards.includes(c));
        const v = bid.kind === 'misere' ? -misereDanger(rest) : estimateTricks(rest, trump) - 0.01 * a.cards.reduce((x, c) => x + rankOf(c), 0);
        if (v > bv) [best, bv] = [a, v];
      }
      return best;
    }
    case 'declare': {
      if (contractOf(s.highRank).kind === 'misere') return { t: 'declare', id: s.highRank };
      let pick = s.highRank;
      for (let id = s.highRank; id <= MAX_BID; id++) {
        const c = contractOf(id);
        if (c.kind !== 'suit') continue;
        const est = estimateTricks(hand, c.suit === NT ? -1 : c.suit);
        if (est >= c.level + (easy ? 0.6 : 0.2)) pick = id;
      }
      return { t: 'declare', id: Math.max(pick, s.highRank) };
    }
    case 'whist': {
      const c = contractOf(s.contract!);
      if (c.kind !== 'suit') return { t: 'whist', yes: true };
      const tr = c.suit === NT ? -1 : c.suit;
      // защитник без козыря-хозяина оценивает масти как «чужие»
      const est = estimateTricks(hand, -1) * 0.8 + (tr >= 0 ? hand.filter((x) => suitOf(x) === tr).length * 0.25 : 0);
      const req = 10 - c.level;
      return { t: 'whist', yes: est + (rng.next() - 0.5) * noise >= Math.max(0.6, req / 2 - 0.3) };
    }
    default:
      break;
  }

  // Розыгрыш
  const t = s.turn;
  const own = s.hands[t]!;
  const options = legal.filter((a): a is Extract<PrefAction, { t: 'play' }> => a.t === 'play').map((a) => a.card);
  if (options.length === 1) return legal.find((a) => a.t === 'play')!;
  const trump = trumpOfState(s);
  const c = s.contract !== null ? contractOf(s.contract) : null;
  const misere = c?.kind === 'misere';
  const avoid = s.allPass || (misere && t === s.declarer);
  const lowest = misere && t !== s.declarer; // защитники мизера играют низко, чтобы заказчик взял
  const wrap = (card: number) => legal.find((a) => a.t === 'play' && a.card === card)!;
  if (easy && rng.next() < 0.3) return legal[rng.int(legal.length)]!;

  const val = (card: number) => rankOf(card) + (suitOf(card) === trump ? 8 : 0);
  const sorted = [...options].sort((a, b) => val(a) - val(b));
  if (lowest) return wrap(sorted[0]!);

  const leadCard = s.trick[0]?.card;
  const leadSuit = leadCard === undefined ? -1 : suitOf(leadCard);
  let best = s.trick[0];
  for (const p of s.trick.slice(1)) if (beats(p.card, best!.card, leadSuit, trump)) best = p;

  if (!best) {
    // заход
    if (avoid) {
      // в распасах/мизере заходим самой низкой картой самой длинной «безопасной» масти
      return wrap(sorted[0]!);
    }
    const aces = options.filter((x) => rankOf(x) === 7 && suitOf(x) !== trump);
    if (aces.length) return wrap(aces[0]!);
    const tops = options.filter((x) => suitOf(x) === trump).sort((a, b) => rankOf(b) - rankOf(a));
    if (tops.length && rankOf(tops[0]!) >= 6) return wrap(tops[0]!);
    // иначе — король с тузом в масти, потом самая низкая из длинной масти
    const kings = options.filter((x) => rankOf(x) === 6 && own.includes(suitOf(x) * 8 + 7));
    if (kings.length) return wrap(kings[0]!);
    return wrap(sorted[0]!);
  }
  const winners = options.filter((x) => beats(x, best!.card, leadSuit, trump));
  if (avoid) {
    const losers = options.filter((x) => !winners.includes(x)).sort((a, b) => val(b) - val(a));
    if (losers.length) return wrap(losers[0]!);
    return wrap(sorted[0]!);
  }
  if (winners.length) {
    const lastToPlay = s.trick.length === 2;
    const ws = winners.sort((a, b) => val(a) - val(b));
    return wrap(lastToPlay ? ws[0]! : ws[ws.length - 1]!);
  }
  return wrap(sorted[0]!);
}
