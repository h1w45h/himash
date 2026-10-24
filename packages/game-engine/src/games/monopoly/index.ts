import { createRng } from '../../core/rng';
import { fail, ok, type GameDefinition, type Outcome, type Seat } from '../../core/types';
import { chooseMonopolyAction } from './ai';
import {
  BOARD, CHANCE, CHEST, GO_SALARY, GROUP_SQUARES, JAIL, JAIL_FINE, RAILS, START_CASH, UTILS,
  type CardDef, type Square,
} from './board';

export * from './board';

export type Variant = 'classic' | 'short';
export type Phase = 'roll' | 'buy' | 'auction' | 'debt' | 'manage' | 'trade';
export type DeckName = 'chance' | 'chest';

export interface Prop {
  owner: Seat;
  /** 0–4 домов, 5 — отель. */
  houses: number;
  mortgaged: boolean;
}
export interface Offer {
  cash: number;
  props: number[];
  /** Сколько карточек «Освобождение из тюрьмы» передаётся. */
  cards: number;
}
export interface Trade {
  from: Seat;
  to: Seat;
  give: Offer;
  get: Offer;
}
export interface Creditor {
  /** null — банк. */
  to: Seat | null;
  amount: number;
}
export interface Debt {
  creditors: Creditor[];
  /** Если долг возник при выходе из тюрьмы, после оплаты нужно сделать ход на столько клеток. */
  moveAfter: number | null;
}
export interface Auction {
  sq: number;
  high: number;
  bidder: Seat | null;
  active: Seat[];
  idx: number;
}

export interface MonopolyState {
  variant: Variant;
  players: number;
  cash: number[];
  pos: number[];
  jail: boolean[];
  jailTries: number[];
  jailCards: DeckName[][];
  bankrupt: boolean[];
  bankruptOrder: Seat[];
  props: (Prop | null)[];
  turn: Seat;
  phase: Phase;
  dice: [number, number] | null;
  doubles: number;
  /** Порядок карточек в колодах (индексы в CHANCE/CHEST); верхняя — первая. */
  chance: number[];
  chest: number[];
  bankHouses: number;
  bankHotels: number;
  auction: Auction | null;
  debt: Debt | null;
  trade: Trade | null;
  /** Последние события для ленты в интерфейсе. */
  log: string[];
  rng: number;
  turnCount: number;
  finished: boolean;
  ranking: Seat[] | null;
}

export type MonopolyAction =
  | { t: 'roll' }
  | { t: 'jailPay' }
  | { t: 'jailCard' }
  | { t: 'buy' }
  | { t: 'decline' }
  | { t: 'bid'; amount: number }
  | { t: 'passBid' }
  | { t: 'build'; sq: number }
  | { t: 'sellHouse'; sq: number }
  | { t: 'mortgage'; sq: number }
  | { t: 'unmortgage'; sq: number }
  | { t: 'trade'; to: Seat; give: Offer; get: Offer }
  | { t: 'accept' }
  | { t: 'reject' }
  | { t: 'endTurn' }
  | { t: 'bankrupt' };

/** Что видит клиент: всё, кроме порядка карт в колодах и состояния генератора. */
export type MonopolyView = Omit<MonopolyState, 'chance' | 'chest' | 'rng'> & {
  chanceLeft: number;
  chestLeft: number;
  netWorth: number[];
};

export const ROUND_LIMIT = 20; // раундов в коротком варианте
const MAX_LOG = 14;
const HOUSES = 32;
const HOTELS = 12;

// ───────── утилиты ─────────

const clone = (s: MonopolyState): MonopolyState => JSON.parse(JSON.stringify(s)) as MonopolyState;
const log = (s: MonopolyState, text: string) => {
  s.log.push(text);
  if (s.log.length > MAX_LOG) s.log.shift();
};
const name = (seat: Seat) => `Игрок ${seat + 1}`;
const sq = (i: number): Square => BOARD[i] as Square;
const alive = (s: MonopolyState) => Array.from({ length: s.players }, (_, i) => i).filter((i) => !s.bankrupt[i]);
const nextAlive = (s: MonopolyState, from: Seat): Seat => {
  for (let i = 1; i <= s.players; i++) if (!s.bankrupt[(from + i) % s.players]) return (from + i) % s.players;
  return from;
};
const ownedBy = (s: MonopolyState, seat: Seat) => s.props.flatMap((p, i) => (p && p.owner === seat ? [i] : []));
const price = (i: number) => {
  const q = sq(i);
  return q.kind === 'street' || q.kind === 'rail' || q.kind === 'util' ? q.price : 0;
};
const mortgageValue = (i: number) => price(i) / 2;
const unmortgageCost = (i: number) => Math.ceil((mortgageValue(i) * 11) / 10); // залог + 10%
const hasSet = (s: MonopolyState, seat: Seat, group: keyof typeof GROUP_SQUARES) =>
  GROUP_SQUARES[group].every((i) => s.props[i]?.owner === seat);

export function netWorth(s: MonopolyState, seat: Seat): number {
  if (s.bankrupt[seat]) return 0;
  let w = s.cash[seat] ?? 0;
  for (const i of ownedBy(s, seat)) {
    const p = s.props[i]!;
    const q = sq(i);
    w += p.mortgaged ? mortgageValue(i) : price(i);
    if (q.kind === 'street') w += p.houses * q.houseCost;
  }
  return w;
}

// ───────── аренда ─────────

function rentFor(s: MonopolyState, i: number, diceSum: number, opts: { doubleRail?: boolean; utilMult?: number } = {}): number {
  const q = sq(i);
  const p = s.props[i];
  if (!p || p.mortgaged) return 0;
  if (q.kind === 'street') {
    const base = q.rent[p.houses] ?? 0;
    return p.houses === 0 && hasSet(s, p.owner, q.group) ? base * 2 : base;
  }
  if (q.kind === 'rail') {
    const n = RAILS.filter((r) => s.props[r]?.owner === p.owner).length;
    return 25 * 2 ** (n - 1) * (opts.doubleRail ? 2 : 1);
  }
  if (q.kind === 'util') {
    const n = UTILS.filter((u) => s.props[u]?.owner === p.owner).length;
    return diceSum * (opts.utilMult ?? (n >= 2 ? 10 : 4));
  }
  return 0;
}

// ───────── платежи ─────────

/** Списывает деньги или переводит игру в фазу долга. Возвращает true, если всё оплачено сразу. */
function charge(s: MonopolyState, payer: Seat, creditors: Creditor[], moveAfter: number | null = null): boolean {
  const list = creditors.filter((c) => c.amount > 0);
  const total = list.reduce((n, c) => n + c.amount, 0);
  if ((s.cash[payer] ?? 0) >= total) {
    settle(s, payer, list);
    return true;
  }
  s.debt = { creditors: list, moveAfter };
  s.phase = 'debt';
  log(s, `${name(payer)} не хватает денег (нужно ${total} ₽) — нужно заложить имущество или объявить банкротство.`);
  return false;
}

function settle(s: MonopolyState, payer: Seat, list: Creditor[]) {
  for (const c of list) {
    s.cash[payer]! -= c.amount;
    if (c.to !== null) s.cash[c.to]! += c.amount;
  }
}

const debtTotal = (d: Debt) => d.creditors.reduce((n, c) => n + c.amount, 0);

/** Если после залога/продажи денег хватает — гасим долг и продолжаем ход. */
function tryPayDebt(s: MonopolyState) {
  const d = s.debt;
  if (!d || s.cash[s.turn]! < debtTotal(d)) return;
  settle(s, s.turn, d.creditors);
  log(s, `${name(s.turn)} погасил долг.`);
  s.debt = null;
  if (d.moveAfter !== null) moveBy(s, s.turn, d.moveAfter);
  else s.phase = 'manage';
}

// ───────── движение ─────────

function sendToJail(s: MonopolyState, seat: Seat) {
  s.pos[seat] = JAIL;
  s.jail[seat] = true;
  s.jailTries[seat] = 0;
  s.doubles = 0;
  log(s, `${name(seat)} отправляется в тюрьму.`);
}

function moveTo(s: MonopolyState, seat: Seat, to: number, collect: boolean, ctx: LandCtx) {
  if (collect && to < s.pos[seat]!) {
    s.cash[seat]! += GO_SALARY;
    log(s, `${name(seat)} проходит «Старт» и получает ${GO_SALARY} ₽.`);
  }
  s.pos[seat] = to;
  landOn(s, seat, ctx);
}

function moveBy(s: MonopolyState, seat: Seat, steps: number) {
  const to = (s.pos[seat]! + steps) % 40;
  moveTo(s, seat, to, true, { sum: steps });
}

interface LandCtx {
  sum: number;
  doubleRail?: boolean;
  utilMult?: number;
}

function landOn(s: MonopolyState, seat: Seat, ctx: LandCtx) {
  const i = s.pos[seat]!;
  const q = sq(i);
  switch (q.kind) {
    case 'street':
    case 'rail':
    case 'util': {
      const p = s.props[i];
      if (!p) {
        s.phase = 'buy';
        log(s, `${name(seat)} попадает на «${q.name}» (${q.price} ₽).`);
        return;
      }
      if (p.owner !== seat && !p.mortgaged) {
        const rent = rentFor(s, i, ctx.sum, ctx);
        log(s, `${name(seat)} платит ${rent} ₽ аренды игроку ${p.owner + 1} за «${q.name}».`);
        if (!charge(s, seat, [{ to: p.owner, amount: rent }])) return;
      }
      break;
    }
    case 'tax':
      log(s, `${name(seat)} платит налог ${q.amount} ₽.`);
      if (!charge(s, seat, [{ to: null, amount: q.amount }])) return;
      break;
    case 'gotojail':
      sendToJail(s, seat);
      break;
    case 'chance':
    case 'chest':
      if (!drawCard(s, seat, q.kind, ctx.sum)) return;
      break;
    default:
      break;
  }
  if (s.phase === 'roll' || s.phase === 'manage') s.phase = 'manage';
}

/** Тянет карточку. Возвращает false, если после неё игра ждёт решения (покупка/долг) — фаза уже выставлена. */
function drawCard(s: MonopolyState, seat: Seat, deck: DeckName, sum: number): boolean {
  const order = deck === 'chance' ? s.chance : s.chest;
  const defs = deck === 'chance' ? CHANCE : CHEST;
  const idx = order.shift() as number;
  const card: CardDef = defs[idx]!;
  log(s, `${deck === 'chance' ? 'Шанс' : 'Казна'}: ${card.text}`);
  if (card.k === 'free') s.jailCards[seat]!.push(deck); // карточку оставляем себе
  else order.push(idx);

  switch (card.k) {
    case 'move':
      moveTo(s, seat, card.to, true, { sum });
      return s.phase === 'manage' || s.phase === 'roll';
    case 'back':
      moveTo(s, seat, (s.pos[seat]! - card.by + 40) % 40, false, { sum });
      return s.phase === 'manage' || s.phase === 'roll';
    case 'nearest': {
      const targets = card.what === 'rail' ? RAILS : UTILS;
      const to = targets.find((t) => t > s.pos[seat]!) ?? targets[0]!;
      moveTo(s, seat, to, true, card.what === 'rail' ? { sum, doubleRail: true } : { sum, utilMult: 10 });
      return s.phase === 'manage' || s.phase === 'roll';
    }
    case 'cash':
      if (card.amount >= 0) {
        s.cash[seat]! += card.amount;
        return true;
      }
      return charge(s, seat, [{ to: null, amount: -card.amount }]);
    case 'jail':
      sendToJail(s, seat);
      return true;
    case 'free':
      return true;
    case 'repairs': {
      let houses = 0;
      let hotels = 0;
      for (const i of ownedBy(s, seat)) {
        const h = s.props[i]!.houses;
        if (h === 5) hotels++;
        else houses += h;
      }
      return charge(s, seat, [{ to: null, amount: houses * card.house + hotels * card.hotel }]);
    }
    case 'eachPay':
      return charge(s, seat, alive(s).filter((x) => x !== seat).map((to) => ({ to, amount: card.amount })));
    case 'eachCollect':
      for (const o of alive(s)) {
        if (o === seat) continue;
        const take = Math.min(card.amount, s.cash[o]!);
        s.cash[o]! -= take;
        s.cash[seat]! += take;
      }
      return true;
  }
}

// ───────── ход игрока ─────────

function doRoll(s: MonopolyState, seat: Seat) {
  const rng = createRng(s.rng);
  const d1 = rng.int(6) + 1;
  const d2 = rng.int(6) + 1;
  s.rng = rng.state;
  s.dice = [d1, d2];
  const sum = d1 + d2;
  const dbl = d1 === d2;
  log(s, `${name(seat)} бросает ${d1} и ${d2}${dbl ? ' (дубль)' : ''}.`);

  if (s.jail[seat]) {
    if (dbl) {
      s.jail[seat] = false;
      s.jailTries[seat] = 0;
      s.doubles = 0; // из тюрьмы дубль не даёт повторного броска
      log(s, `${name(seat)} выбрасывает дубль и выходит из тюрьмы.`);
      moveBy(s, seat, sum);
    } else {
      s.doubles = 0;
      s.jailTries[seat]!++;
      if (s.jailTries[seat]! >= 3) {
        s.jail[seat] = false;
        s.jailTries[seat] = 0;
        log(s, `${name(seat)} третий раз не выбросил дубль: штраф ${JAIL_FINE} ₽ и выход из тюрьмы.`);
        if (charge(s, seat, [{ to: null, amount: JAIL_FINE }], sum)) moveBy(s, seat, sum);
      } else {
        s.phase = 'manage';
      }
    }
    return;
  }

  if (dbl) {
    s.doubles++;
    if (s.doubles >= 3) {
      log(s, `${name(seat)} выбросил три дубля подряд.`);
      sendToJail(s, seat);
      s.phase = 'manage';
      return;
    }
  } else {
    s.doubles = 0;
  }
  moveBy(s, seat, sum);
}

function endTurn(s: MonopolyState) {
  s.turnCount++;
  s.dice = null;
  s.doubles = 0;
  if (s.variant === 'short' && s.turnCount >= s.players * ROUND_LIMIT) {
    const ranking = alive(s).sort((a, b) => netWorth(s, b) - netWorth(s, a));
    log(s, 'Лимит раундов исчерпан — побеждает самый богатый.');
    finish(s, ranking);
    return;
  }
  s.turn = nextAlive(s, s.turn);
  s.phase = 'roll';
  log(s, `Ход игрока ${s.turn + 1}.`);
}

function finish(s: MonopolyState, aliveRanking: Seat[]) {
  s.finished = true;
  s.ranking = [...aliveRanking, ...[...s.bankruptOrder].reverse()];
  s.phase = 'manage';
}

function declareBankruptcy(s: MonopolyState, seat: Seat) {
  const creditors = s.debt?.creditors ?? [];
  const players = creditors.filter((c) => c.to !== null);
  const heir = players.length === 1 && creditors.length === 1 ? (players[0]!.to as Seat) : null;
  log(s, `${name(seat)} банкрот!${heir !== null ? ` Всё имущество переходит игроку ${heir + 1}.` : ''}`);

  for (const i of ownedBy(s, seat)) {
    const p = s.props[i]!;
    // Постройки возвращаются банку.
    if (p.houses === 5) s.bankHotels++;
    else s.bankHouses += p.houses;
    p.houses = 0;
    if (heir !== null) p.owner = heir;
    else s.props[i] = null;
  }
  if (heir !== null) {
    s.cash[heir]! += s.cash[seat]!;
    s.jailCards[heir]!.push(...s.jailCards[seat]!);
  } else {
    for (const d of s.jailCards[seat]!) (d === 'chance' ? s.chance : s.chest).push(d === 'chance' ? CHANCE.findIndex((c) => c.k === 'free') : CHEST.findIndex((c) => c.k === 'free'));
  }
  s.cash[seat] = 0;
  s.jailCards[seat] = [];
  s.bankrupt[seat] = true;
  s.bankruptOrder.push(seat);
  s.debt = null;
  s.auction = null;
  s.trade = null;

  const left = alive(s);
  if (left.length === 1) {
    log(s, `${name(left[0]!)} побеждает!`);
    finish(s, left);
    return;
  }
  endTurn(s);
}

// ───────── аукцион ─────────

function startAuction(s: MonopolyState, square: number) {
  const order = alive(s);
  const first = order.indexOf(s.turn);
  const active = [...order.slice(first + 1), ...order.slice(0, first + 1)]; // начинает следующий за ходящим
  s.auction = { sq: square, high: 0, bidder: null, active, idx: 0 };
  s.phase = 'auction';
  log(s, `Аукцион: «${sq(square).name}».`);
}

function resolveAuctionIfDone(s: MonopolyState) {
  const a = s.auction;
  if (!a) return;
  const done = a.active.length === 0 || (a.bidder !== null && a.active.length === 1);
  if (!done) return;
  if (a.bidder !== null) {
    s.cash[a.bidder]! -= a.high;
    s.props[a.sq] = { owner: a.bidder, houses: 0, mortgaged: false };
    log(s, `${name(a.bidder)} выигрывает аукцион за ${a.high} ₽.`);
  } else {
    log(s, 'Никто не купил — собственность остаётся банку.');
  }
  s.auction = null;
  s.phase = 'manage';
}

// ───────── постройки и залог ─────────

function groupOf(i: number) {
  const q = sq(i);
  return q.kind === 'street' ? q.group : null;
}

export function canBuild(s: MonopolyState, seat: Seat, i: number): boolean {
  const q = sq(i);
  const p = s.props[i];
  if (q.kind !== 'street' || !p || p.owner !== seat || p.mortgaged || p.houses >= 5) return false;
  if (!hasSet(s, seat, q.group)) return false;
  const group = GROUP_SQUARES[q.group];
  if (group.some((g) => s.props[g]!.mortgaged)) return false;
  if (p.houses > Math.min(...group.map((g) => s.props[g]!.houses))) return false; // равномерная застройка
  if (s.cash[seat]! < q.houseCost) return false;
  return p.houses === 4 ? s.bankHotels > 0 : s.bankHouses > 0;
}

export function canSellHouse(s: MonopolyState, seat: Seat, i: number): boolean {
  const q = sq(i);
  const p = s.props[i];
  if (q.kind !== 'street' || !p || p.owner !== seat || p.houses === 0) return false;
  const group = GROUP_SQUARES[q.group];
  if (p.houses < Math.max(...group.map((g) => s.props[g]!.houses))) return false;
  return p.houses !== 5 || s.bankHouses >= 4; // отель разбирается на 4 дома — они должны быть в банке
}

export function canMortgage(s: MonopolyState, seat: Seat, i: number): boolean {
  const p = s.props[i];
  if (!p || p.owner !== seat || p.mortgaged) return false;
  const g = groupOf(i);
  return !(g && GROUP_SQUARES[g].some((x) => (s.props[x]?.houses ?? 0) > 0));
}

export function canUnmortgage(s: MonopolyState, seat: Seat, i: number): boolean {
  const p = s.props[i];
  return !!p && p.owner === seat && p.mortgaged && s.cash[seat]! >= unmortgageCost(i);
}

// ───────── обмен ─────────

function validateOffer(s: MonopolyState, owner: Seat, o: Offer, who: string): string | null {
  if (!Number.isInteger(o.cash) || o.cash < 0 || o.cash > s.cash[owner]!) return `${who}: недостаточно денег для предложения`;
  if (!Number.isInteger(o.cards) || o.cards < 0 || o.cards > s.jailCards[owner]!.length) return `${who}: нет столько карточек`;
  if (new Set(o.props).size !== o.props.length) return 'Повторяющиеся поля в предложении';
  for (const i of o.props) {
    if (!Number.isInteger(i) || s.props[i]?.owner !== owner) return `${who}: вы не владеете этой собственностью`;
    const g = groupOf(i);
    if (g && GROUP_SQUARES[g].some((x) => (s.props[x]?.houses ?? 0) > 0)) return 'Нельзя обменивать улицы с постройками — сначала продайте дома';
  }
  return null;
}

function validateTrade(s: MonopolyState, seat: Seat, a: Extract<MonopolyAction, { t: 'trade' }>): string | null {
  if (!Number.isInteger(a.to) || a.to === seat || a.to < 0 || a.to >= s.players || s.bankrupt[a.to]) return 'Неверный получатель';
  const empty = (o: Offer) => o.cash === 0 && o.props.length === 0 && o.cards === 0;
  if (empty(a.give) && empty(a.get)) return 'Пустое предложение';
  return validateOffer(s, seat, a.give, 'Вы') ?? validateOffer(s, a.to, a.get, name(a.to));
}

function executeTrade(s: MonopolyState, t: Trade) {
  const move = (from: Seat, to: Seat, o: Offer) => {
    s.cash[from]! -= o.cash;
    s.cash[to]! += o.cash;
    for (const i of o.props) s.props[i]!.owner = to;
    s.jailCards[to]!.push(...s.jailCards[from]!.splice(0, o.cards));
  };
  move(t.from, t.to, t.give);
  move(t.to, t.from, t.get);
}

// ───────── определение игры ─────────

const MANAGE_PHASES: Phase[] = ['roll', 'manage', 'debt'];

export const monopolyGame: GameDefinition<MonopolyState, MonopolyAction, MonopolyView, { variant?: Variant }> = {
  slug: 'monopoly',
  minPlayers: 2,
  maxPlayers: 6,

  setup: ({ players, seed, variant }) => {
    const rng = createRng(seed);
    const s: MonopolyState = {
      variant: variant === 'short' ? 'short' : 'classic',
      players,
      cash: Array(players).fill(START_CASH),
      pos: Array(players).fill(0),
      jail: Array(players).fill(false),
      jailTries: Array(players).fill(0),
      jailCards: Array.from({ length: players }, () => []),
      bankrupt: Array(players).fill(false),
      bankruptOrder: [],
      props: Array(40).fill(null),
      turn: 0,
      phase: 'roll',
      dice: null,
      doubles: 0,
      chance: rng.shuffle(CHANCE.map((_, i) => i)),
      chest: rng.shuffle(CHEST.map((_, i) => i)),
      bankHouses: HOUSES,
      bankHotels: HOTELS,
      auction: null,
      debt: null,
      trade: null,
      log: ['Игра началась. Ход игрока 1.'],
      rng: rng.state,
      turnCount: 0,
      finished: false,
      ranking: null,
    };
    return s;
  },

  currentSeats: (s) => {
    if (s.finished) return [];
    if (s.phase === 'auction' && s.auction) return [s.auction.active[s.auction.idx] as Seat];
    if (s.phase === 'trade' && s.trade) return [s.trade.to];
    return [s.turn];
  },

  legalActions: (s, seat) => {
    if (s.finished || !monopolyGame.currentSeats(s).includes(seat)) return [];
    const acts: MonopolyAction[] = [];
    const manage = () => {
      for (const i of ownedBy(s, seat)) {
        if (s.phase !== 'debt' && canBuild(s, seat, i)) acts.push({ t: 'build', sq: i });
        if (canSellHouse(s, seat, i)) acts.push({ t: 'sellHouse', sq: i });
        if (canMortgage(s, seat, i)) acts.push({ t: 'mortgage', sq: i });
        if (s.phase !== 'debt' && canUnmortgage(s, seat, i)) acts.push({ t: 'unmortgage', sq: i });
      }
    };
    switch (s.phase) {
      case 'roll':
        acts.push({ t: 'roll' });
        if (s.jail[seat]) {
          if (s.cash[seat]! >= JAIL_FINE) acts.push({ t: 'jailPay' });
          if (s.jailCards[seat]!.length > 0) acts.push({ t: 'jailCard' });
        }
        manage();
        break;
      case 'buy':
        if (s.cash[seat]! >= price(s.pos[seat]!)) acts.push({ t: 'buy' });
        acts.push({ t: 'decline' });
        break;
      case 'auction': {
        const a = s.auction!;
        const cash = s.cash[seat]!;
        for (const step of [10, 50, 100, 200]) {
          const amount = a.high + step;
          if (amount <= cash && !acts.some((x) => x.t === 'bid' && x.amount === amount)) acts.push({ t: 'bid', amount });
        }
        acts.push({ t: 'passBid' });
        break;
      }
      case 'debt':
        manage();
        acts.push({ t: 'bankrupt' });
        break;
      case 'manage':
        manage();
        acts.push(s.doubles > 0 && !s.jail[seat] ? { t: 'roll' } : { t: 'endTurn' });
        break;
      case 'trade':
        acts.push({ t: 'accept' }, { t: 'reject' });
        break;
    }
    return acts;
  },

  validate: (s, seat, a) => {
    if (s.finished) return fail('Партия завершена');
    if (!monopolyGame.currentSeats(s).includes(seat)) return fail('Сейчас не ваш ход');
    const act = a as MonopolyAction | null;
    if (!act || typeof act !== 'object') return fail('Некорректное действие');
    if (act.t === 'trade') {
      if (!MANAGE_PHASES.slice(0, 2).includes(s.phase)) return fail('Обмен сейчас недоступен');
      const err = validateTrade(s, seat, act);
      return err ? fail(err) : ok(undefined);
    }
    if (act.t === 'bid') {
      const au = s.auction;
      if (s.phase !== 'auction' || !au) return fail('Аукцион не идёт');
      if (!Number.isInteger(act.amount) || act.amount < au.high + 10) return fail(`Ставка должна быть не меньше ${au.high + 10} ₽`);
      return act.amount <= s.cash[seat]! ? ok(undefined) : fail('Недостаточно денег');
    }
    const legal = monopolyGame.legalActions(s, seat);
    const same = legal.some((x) => x.t === act.t && ('sq' in x ? x.sq === (act as { sq?: number }).sq : true));
    return same ? ok(undefined) : fail('Это действие сейчас недоступно');
  },

  apply: (prev, seat, a) => {
    const s = clone(prev);
    switch (a.t) {
      case 'roll':
        doRoll(s, seat);
        break;
      case 'jailPay':
        s.cash[seat]! -= JAIL_FINE;
        s.jail[seat] = false;
        s.jailTries[seat] = 0;
        log(s, `${name(seat)} платит ${JAIL_FINE} ₽ и выходит из тюрьмы.`);
        break;
      case 'jailCard': {
        const deck = s.jailCards[seat]!.pop() as DeckName;
        (deck === 'chance' ? s.chance : s.chest).push(
          (deck === 'chance' ? CHANCE : CHEST).findIndex((c) => c.k === 'free'),
        );
        s.jail[seat] = false;
        s.jailTries[seat] = 0;
        log(s, `${name(seat)} использует карточку освобождения.`);
        break;
      }
      case 'buy': {
        const i = s.pos[seat]!;
        s.cash[seat]! -= price(i);
        s.props[i] = { owner: seat, houses: 0, mortgaged: false };
        log(s, `${name(seat)} покупает «${sq(i).name}» за ${price(i)} ₽.`);
        s.phase = 'manage';
        break;
      }
      case 'decline':
        startAuction(s, s.pos[seat]!);
        break;
      case 'bid': {
        const au = s.auction!;
        au.high = a.amount;
        au.bidder = seat;
        au.idx = (au.idx + 1) % au.active.length;
        log(s, `${name(seat)} ставит ${a.amount} ₽.`);
        resolveAuctionIfDone(s); // остался единственный претендент — он и покупает
        break;
      }
      case 'passBid': {
        const au = s.auction!;
        au.active.splice(au.idx, 1);
        if (au.active.length > 0) au.idx %= au.active.length;
        log(s, `${name(seat)} пасует.`);
        resolveAuctionIfDone(s);
        break;
      }
      case 'build': {
        const p = s.props[a.sq]!;
        const q = sq(a.sq) as Extract<Square, { kind: 'street' }>;
        s.cash[seat]! -= q.houseCost;
        if (p.houses === 4) {
          s.bankHotels--;
          s.bankHouses += 4;
        } else {
          s.bankHouses--;
        }
        p.houses++;
        log(s, `${name(seat)} строит ${p.houses === 5 ? 'отель' : 'дом'} на «${q.name}».`);
        break;
      }
      case 'sellHouse': {
        const p = s.props[a.sq]!;
        const q = sq(a.sq) as Extract<Square, { kind: 'street' }>;
        s.cash[seat]! += q.houseCost / 2;
        if (p.houses === 5) {
          s.bankHotels++;
          s.bankHouses -= 4;
        } else {
          s.bankHouses++;
        }
        p.houses--;
        log(s, `${name(seat)} продаёт постройку на «${q.name}».`);
        tryPayDebt(s);
        break;
      }
      case 'mortgage':
        s.props[a.sq]!.mortgaged = true;
        s.cash[seat]! += mortgageValue(a.sq);
        log(s, `${name(seat)} закладывает «${sq(a.sq).name}».`);
        tryPayDebt(s);
        break;
      case 'unmortgage':
        s.props[a.sq]!.mortgaged = false;
        s.cash[seat]! -= unmortgageCost(a.sq);
        log(s, `${name(seat)} выкупает «${sq(a.sq).name}».`);
        break;
      case 'trade':
        s.trade = { from: seat, to: a.to, give: a.give, get: a.get };
        s.phase = 'trade';
        log(s, `${name(seat)} предлагает обмен игроку ${a.to + 1}.`);
        break;
      case 'accept': {
        const t = s.trade!;
        // Состав мог измениться — проверяем предложение заново перед исполнением.
        if (validateTrade(s, t.from, { t: 'trade', to: t.to, give: t.give, get: t.get })) {
          log(s, 'Обмен отменён: условия больше не выполняются.');
        } else {
          executeTrade(s, t);
          log(s, `Обмен между игроками ${t.from + 1} и ${t.to + 1} состоялся.`);
        }
        s.trade = null;
        s.phase = s.dice === null ? 'roll' : 'manage';
        break;
      }
      case 'reject':
        log(s, `${name(seat)} отклоняет обмен.`);
        s.trade = null;
        s.phase = s.dice === null ? 'roll' : 'manage';
        break;
      case 'endTurn':
        endTurn(s);
        break;
      case 'bankrupt':
        declareBankruptcy(s, seat);
        break;
    }
    return s;
  },

  outcome: (s): Outcome | null => {
    if (!s.finished || !s.ranking) return null;
    const winner = s.ranking[0] as Seat;
    return { winners: [winner], ranking: s.ranking, reason: s.variant === 'short' && alive(s).length > 1 ? 'netWorth' : 'monopoly' };
  },

  view: (s) => {
    const { chance, chest, rng: _rng, ...rest } = s;
    return { ...rest, chanceLeft: chance.length, chestLeft: chest.length, netWorth: Array.from({ length: s.players }, (_, i) => netWorth(s, i)) };
  },

  timeoutAction: (s, seat) => {
    switch (s.phase) {
      case 'roll': return { t: 'roll' };
      case 'buy': return { t: 'decline' };
      case 'auction': return { t: 'passBid' };
      case 'debt': return { t: 'bankrupt' };
      case 'trade': return { t: 'reject' };
      default: return s.doubles > 0 && !s.jail[seat] ? { t: 'roll' } : { t: 'endTurn' };
    }
  },

  chooseBotAction: (s, seat, bot) => chooseMonopolyAction(s, seat, bot),
};

export { alive, hasSet, mortgageValue, ownedBy, unmortgageCost, price, rentFor };
