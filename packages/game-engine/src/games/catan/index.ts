import { createRng } from '../../core/rng';
import { fail, ok, type BotContext, type GameDefinition, type Outcome, type Result, type Seat } from '../../core/types';
import { BOARD, EDGE_COUNT, HEX_COUNT, HEX_ORDER, PIPS, VERT_COUNT } from './board';

export * from './board';

/**
 * Колонизаторы («Катан»), 2–4 игрока. Классическое поле из 19 гексов, 9 гаваней, разбойник, 25 карт развития,
 * самая длинная дорога (+2) и самое большое войско (+2). Победа — 10 очков в свой ход.
 * Правила ресурсов банка: при нехватке один получатель берёт остаток, несколько — не получают никто.
 */
export const RES = ['лес', 'глина', 'овца', 'пшеница', 'руда'] as const;
export const DEV = ['рыцарь', 'строительство дорог', 'изобилие', 'монополия', 'очко победы'] as const;
export const KNIGHT = 0;
export const ROADS = 1;
export const PLENTY = 2;
export const MONO = 3;
export const VPCARD = 4;

export const COST = {
  road: [1, 1, 0, 0, 0],
  settlement: [1, 1, 1, 1, 0],
  city: [0, 0, 0, 2, 3],
  dev: [0, 0, 1, 1, 1],
} as const;
const MAX_ROADS = 15;
const MAX_SETTLEMENTS = 5;
const MAX_CITIES = 4;
const WIN_VP = 10;
/** Тип гавани: 0–4 — «2:1» по ресурсу, 5 — «3:1» любой. */
export const GENERIC_PORT = 5;

export type Phase = 'setup' | 'roll' | 'discard' | 'robber' | 'steal' | 'main' | 'roads' | 'over';

export interface Offer {
  from: Seat;
  give: number[];
  get: number[];
  /** 0 — не ответил, 1 — согласен, 2 — отказ. */
  responses: number[];
}

export interface CatanState {
  players: number;
  hexRes: number[]; // −1 — пустыня
  hexNum: number[]; // 0 — без жетона
  ports: number[]; // тип гавани для каждого из 9 слотов
  vOwner: number[];
  vKind: number[]; // 0 — пусто, 1 — поселение, 2 — город
  eOwner: number[];
  robber: number;
  hands: number[][];
  dev: number[][];
  /** Карты развития, купленные в этот ход (играть нельзя). */
  devNew: number[];
  devDeck: number[];
  bank: number[];
  knights: number[];
  longest: { holder: number; len: number };
  army: number;
  phase: Phase;
  turn: Seat;
  rolled: boolean;
  dice: [number, number] | null;
  setupIdx: number;
  setupStep: 'settlement' | 'road';
  lastSettle: number;
  discardNeed: number[];
  stealFrom: number[];
  freeRoads: number;
  devPlayed: boolean;
  offer: Offer | null;
  offersLeft: number;
  rng: number;
  turnCount: number;
  log: string[];
  winner: number | null;
}

export type CatanAction =
  | { t: 'build'; what: 'road' | 'settlement' | 'city'; at: number }
  | { t: 'roll' }
  | { t: 'discard'; cards: number[] }
  | { t: 'moveRobber'; hex: number }
  | { t: 'steal'; from: Seat }
  | { t: 'buyDev' }
  | { t: 'playKnight' }
  | { t: 'playRoads' }
  | { t: 'playPlenty'; a: number; b: number }
  | { t: 'playMonopoly'; res: number }
  | { t: 'bank'; give: number; get: number }
  | { t: 'offer'; give: number[]; get: number[] }
  | { t: 'respond'; accept: boolean }
  | { t: 'confirm'; with: Seat }
  | { t: 'cancel' }
  | { t: 'end' };

export interface CatanView extends Omit<CatanState, 'hands' | 'dev' | 'devNew' | 'devDeck' | 'rng'> {
  hand: number[] | null;
  handCounts: number[];
  myDev: number[] | null;
  myDevNew: number[] | null;
  devCounts: number[];
  devDeckCount: number;
  /** Публичные очки (без скрытых карт «очко победы»). */
  vp: number[];
  myVp: number | null;
  roadLens: number[];
  finished: boolean;
}

const clone = (s: CatanState): CatanState => JSON.parse(JSON.stringify(s)) as CatanState;
const name = (seat: Seat) => `Игрок ${seat + 1}`;
const sum = (a: readonly number[]) => a.reduce((x, y) => x + y, 0);
const log = (s: CatanState, t: string) => {
  s.log.push(t);
  if (s.log.length > 14) s.log.shift();
};
const setupOrder = (n: number, i: number) => (i < n ? i : 2 * n - 1 - i);

// ───────── вспомогательные расчёты ─────────

export const piecesLeft = (s: CatanState, p: Seat) => ({
  roads: MAX_ROADS - s.eOwner.filter((o) => o === p).length,
  settlements: MAX_SETTLEMENTS - s.vOwner.filter((o, v) => o === p && s.vKind[v] === 1).length,
  cities: MAX_CITIES - s.vOwner.filter((o, v) => o === p && s.vKind[v] === 2).length,
});

export function publicVp(s: CatanState, p: Seat): number {
  let v = 0;
  for (let i = 0; i < VERT_COUNT; i++) if (s.vOwner[i] === p) v += s.vKind[i]!;
  if (s.longest.holder === p) v += 2;
  if (s.army === p) v += 2;
  return v;
}
export const totalVp = (s: CatanState, p: Seat) => publicVp(s, p) + s.dev[p]![VPCARD]!;

/** Курс обмена с банком для ресурса `r`: 4, 3 (общая гавань) или 2 (своя гавань). */
export function tradeRatio(s: CatanState, p: Seat, r: number): number {
  let ratio = 4;
  s.ports.forEach((type, slot) => {
    const e = BOARD.edges[BOARD.portEdges[slot]!]!;
    if (s.vOwner[e.a] !== p && s.vOwner[e.b] !== p) return;
    if (type === GENERIC_PORT) ratio = Math.min(ratio, 3);
    else if (type === r) ratio = 2;
  });
  return ratio;
}

const canAfford = (hand: number[], cost: readonly number[]) => cost.every((c, i) => hand[i]! >= c);

export const settleFree = (s: CatanState, v: number) => s.vOwner[v] === -1 && BOARD.verts[v]!.adj.every((a) => s.vOwner[a] === -1);

function roadReachable(s: CatanState, p: Seat, e: number): boolean {
  if (s.eOwner[e] !== -1) return false;
  const ed = BOARD.edges[e]!;
  return [ed.a, ed.b].some((x) => s.vOwner[x] === p || (s.vOwner[x] === -1 && BOARD.verts[x]!.edges.some((o) => o !== e && s.eOwner[o] === p)));
}
const settleConnected = (s: CatanState, p: Seat, v: number) => BOARD.verts[v]!.edges.some((e) => s.eOwner[e] === p);

export function roadSpots(s: CatanState, p: Seat): number[] {
  if (piecesLeft(s, p).roads <= 0) return [];
  const out: number[] = [];
  for (let e = 0; e < EDGE_COUNT; e++) if (roadReachable(s, p, e)) out.push(e);
  return out;
}
export function settleSpots(s: CatanState, p: Seat): number[] {
  if (piecesLeft(s, p).settlements <= 0) return [];
  const out: number[] = [];
  for (let v = 0; v < VERT_COUNT; v++) if (settleFree(s, v) && settleConnected(s, p, v)) out.push(v);
  return out;
}
export const citySpots = (s: CatanState, p: Seat): number[] =>
  piecesLeft(s, p).cities > 0 ? s.vOwner.map((o, v) => (o === p && s.vKind[v] === 1 ? v : -1)).filter((v) => v >= 0) : [];

/** Длина самой длинной дороги игрока. Чужое поселение прерывает путь. */
export function roadLength(s: CatanState, p: Seat): number {
  if (!s.eOwner.includes(p)) return 0;
  const used = new Set<number>();
  let best = 0;
  const dfs = (v: number, len: number) => {
    if (len > best) best = len;
    for (const e of BOARD.verts[v]!.edges) {
      if (s.eOwner[e] !== p || used.has(e)) continue;
      const ed = BOARD.edges[e]!;
      const o = ed.a === v ? ed.b : ed.a;
      used.add(e);
      if (s.vOwner[o] !== -1 && s.vOwner[o] !== p) best = Math.max(best, len + 1);
      else dfs(o, len + 1);
      used.delete(e);
    }
  };
  for (let v = 0; v < VERT_COUNT; v++) if (BOARD.verts[v]!.edges.some((e) => s.eOwner[e] === p)) dfs(v, 0);
  return best;
}

function updateLongest(s: CatanState) {
  const lens = Array.from({ length: s.players }, (_, p) => roadLength(s, p));
  const max = Math.max(...lens);
  const holder = s.longest.holder;
  if (holder >= 0 && lens[holder]! >= max && lens[holder]! >= 5) {
    s.longest.len = lens[holder]!;
    return;
  }
  const top = lens.map((l, p) => (l === max && l >= 5 ? p : -1)).filter((p) => p >= 0);
  const prev = holder;
  s.longest = top.length === 1 ? { holder: top[0]!, len: max } : { holder: -1, len: 0 };
  if (s.longest.holder !== prev && s.longest.holder >= 0) log(s, `${name(s.longest.holder)} получает «Самую длинную дорогу» (${max}).`);
}

const pay = (s: CatanState, p: Seat, cost: readonly number[]) =>
  cost.forEach((c, i) => {
    s.hands[p]![i]! -= c;
    s.bank[i]! += c;
  });

function resume(s: CatanState) {
  s.phase = s.rolled ? 'main' : 'roll';
}

function checkWin(s: CatanState) {
  if (s.phase === 'setup' || s.phase === 'over') return;
  if (totalVp(s, s.turn) >= WIN_VP) {
    s.phase = 'over';
    s.winner = s.turn;
    log(s, `${name(s.turn)} набирает ${totalVp(s, s.turn)} очков и побеждает!`);
  }
}

function produce(s: CatanState, roll: number) {
  const want = Array.from({ length: s.players }, () => [0, 0, 0, 0, 0]);
  s.hexNum.forEach((num, hi) => {
    if (num !== roll || hi === s.robber) return;
    for (const v of BOARD.hexes[hi]!.verts) if (s.vOwner[v]! >= 0) want[s.vOwner[v]!]![s.hexRes[hi]!]! += s.vKind[v]!;
  });
  for (let r = 0; r < 5; r++) {
    const askers = want.filter((w) => w[r]! > 0).length;
    const total = want.reduce((x, w) => x + w[r]!, 0);
    if (total === 0) continue;
    if (total <= s.bank[r]!) {
      want.forEach((w, p) => {
        s.hands[p]![r]! += w[r]!;
      });
      s.bank[r]! -= total;
    } else if (askers === 1) {
      const p = want.findIndex((w) => w[r]! > 0);
      s.hands[p]![r]! += s.bank[r]!;
      s.bank[r] = 0;
    } else log(s, `В банке не хватает ресурса «${RES[r]}» — никто его не получает.`);
  }
}

function stealCard(s: CatanState, thief: Seat, victim: Seat) {
  const hand = s.hands[victim]!;
  const total = sum(hand);
  if (total === 0) return;
  const rng = createRng(s.rng);
  let k = rng.int(total);
  s.rng = rng.state;
  for (let r = 0; r < 5; r++) {
    if (k < hand[r]!) {
      hand[r]!--;
      s.hands[thief]![r]!++;
      break;
    }
    k -= hand[r]!;
  }
  log(s, `${name(thief)} крадёт карту у ${name(victim)}.`);
}

const robberVictims = (s: CatanState, hex: number): number[] =>
  [...new Set(BOARD.hexes[hex]!.verts.map((v) => s.vOwner[v]!))].filter((p) => p >= 0 && p !== s.turn && sum(s.hands[p]!) > 0);

/** Подсказка «что сбросить»: из самых многочисленных ресурсов. */
function autoDiscard(s: CatanState, seat: Seat): number[] {
  const hand = [...s.hands[seat]!];
  const out = [0, 0, 0, 0, 0];
  for (let k = 0; k < s.discardNeed[seat]!; k++) {
    let best = 0;
    for (let r = 1; r < 5; r++) if (hand[r]! > hand[best]!) best = r;
    hand[best]!--;
    out[best]!++;
  }
  return out;
}

function devPlays(s: CatanState, seat: Seat): CatanAction[] {
  if (s.devPlayed) return [];
  const can = (k: number) => s.dev[seat]![k]! - (seat === s.turn ? s.devNew[k]! : 0) > 0;
  const out: CatanAction[] = [];
  if (can(KNIGHT)) out.push({ t: 'playKnight' });
  if (can(ROADS) && roadSpots(s, seat).length > 0) out.push({ t: 'playRoads' });
  if (can(PLENTY)) for (let a = 0; a < 5; a++) for (let b = a; b < 5; b++) if (a === b ? s.bank[a]! >= 2 : s.bank[a]! >= 1 && s.bank[b]! >= 1) out.push({ t: 'playPlenty', a, b });
  if (can(MONO)) for (let r = 0; r < 5; r++) out.push({ t: 'playMonopoly', res: r });
  return out;
}

const same = (a: CatanAction, b: CatanAction) => JSON.stringify(a) === JSON.stringify(b);

function validOffer(s: CatanState, seat: Seat, a: Extract<CatanAction, { t: 'offer' }>): string | null {
  if (a.give.length !== 5 || a.get.length !== 5) return 'Неверное предложение';
  if (![...a.give, ...a.get].every((x) => Number.isInteger(x) && x >= 0 && x <= 19)) return 'Неверное предложение';
  if (sum(a.give) === 0 || sum(a.get) === 0) return 'Нужно что-то отдать и что-то получить';
  if (a.give.some((g, i) => g > 0 && a.get[i]! > 0)) return 'Нельзя менять ресурс сам на себя';
  if (!canAfford(s.hands[seat]!, a.give)) return 'Не хватает ресурсов';
  return null;
}

export const catanGame: GameDefinition<CatanState, CatanAction, CatanView> = {
  slug: 'catan',
  minPlayers: 2,
  maxPlayers: 4,

  setup: ({ players, seed }) => {
    const rng = createRng(seed);
    const pool = rng.shuffle([-1, ...[0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4]]);
    const tokens = [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11];
    let t = 0;
    const hexNum = pool.map((r) => (r === -1 ? 0 : tokens[t++]!));
    const devDeck = rng.shuffle([...Array(14).fill(KNIGHT), ...Array(2).fill(ROADS), ...Array(2).fill(PLENTY), ...Array(2).fill(MONO), ...Array(5).fill(VPCARD)]);
    const ports = rng.shuffle([0, 1, 2, 3, 4, 5, 5, 5, 5]);
    const s: CatanState = {
      players,
      hexRes: pool,
      hexNum,
      ports,
      vOwner: Array(VERT_COUNT).fill(-1),
      vKind: Array(VERT_COUNT).fill(0),
      eOwner: Array(EDGE_COUNT).fill(-1),
      robber: pool.indexOf(-1),
      hands: Array.from({ length: players }, () => [0, 0, 0, 0, 0]),
      dev: Array.from({ length: players }, () => [0, 0, 0, 0, 0]),
      devNew: [0, 0, 0, 0, 0],
      devDeck,
      bank: [19, 19, 19, 19, 19],
      knights: Array(players).fill(0),
      longest: { holder: -1, len: 0 },
      army: -1,
      phase: 'setup',
      turn: 0,
      rolled: false,
      dice: null,
      setupIdx: 0,
      setupStep: 'settlement',
      lastSettle: -1,
      discardNeed: Array(players).fill(0),
      stealFrom: [],
      freeRoads: 0,
      devPlayed: false,
      offer: null,
      offersLeft: 3,
      rng: rng.state,
      turnCount: 0,
      log: ['Расстановка: каждый строит поселение и дорогу, затем в обратном порядке ещё одну пару.'],
      winner: null,
    };
    return s;
  },

  currentSeats: (s) => {
    if (s.phase === 'over') return [];
    if (s.phase === 'discard') return s.discardNeed.map((n, p) => (n > 0 ? p : -1)).filter((p) => p >= 0);
    if (s.offer) return [s.offer.from, ...s.offer.responses.map((r, p) => (p !== s.offer!.from && r === 0 ? p : -1)).filter((p) => p >= 0)];
    return [s.turn];
  },

  legalActions: (s, seat) => {
    if (s.phase === 'over') return [];
    const out: CatanAction[] = [];
    if (s.phase === 'discard') {
      if (s.discardNeed[seat]! > 0) out.push({ t: 'discard', cards: autoDiscard(s, seat) });
      return out;
    }
    if (s.offer) {
      const o = s.offer;
      if (seat === o.from) {
        o.responses.forEach((r, p) => {
          if (r === 1 && canAfford(s.hands[p]!, o.get) && canAfford(s.hands[seat]!, o.give)) out.push({ t: 'confirm', with: p });
        });
        out.push({ t: 'cancel' });
      } else if (o.responses[seat] === 0) {
        if (canAfford(s.hands[seat]!, o.get)) out.push({ t: 'respond', accept: true });
        out.push({ t: 'respond', accept: false });
      }
      return out;
    }
    if (seat !== s.turn) return out;
    const hand = s.hands[seat]!;
    switch (s.phase) {
      case 'setup':
        if (s.setupStep === 'settlement') {
          for (let v = 0; v < VERT_COUNT; v++) if (settleFree(s, v)) out.push({ t: 'build', what: 'settlement', at: v });
        } else for (const e of BOARD.verts[s.lastSettle]!.edges) if (s.eOwner[e] === -1) out.push({ t: 'build', what: 'road', at: e });
        break;
      case 'roll':
        out.push({ t: 'roll' }, ...devPlays(s, seat));
        break;
      case 'robber':
        for (let h = 0; h < HEX_COUNT; h++) if (h !== s.robber) out.push({ t: 'moveRobber', hex: h });
        break;
      case 'steal':
        for (const p of s.stealFrom) out.push({ t: 'steal', from: p });
        break;
      case 'roads':
        for (const e of roadSpots(s, seat)) out.push({ t: 'build', what: 'road', at: e });
        break;
      case 'main': {
        if (canAfford(hand, COST.road)) for (const e of roadSpots(s, seat)) out.push({ t: 'build', what: 'road', at: e });
        if (canAfford(hand, COST.settlement)) for (const v of settleSpots(s, seat)) out.push({ t: 'build', what: 'settlement', at: v });
        if (canAfford(hand, COST.city)) for (const v of citySpots(s, seat)) out.push({ t: 'build', what: 'city', at: v });
        if (canAfford(hand, COST.dev) && s.devDeck.length > 0) out.push({ t: 'buyDev' });
        out.push(...devPlays(s, seat));
        for (let g = 0; g < 5; g++) {
          if (hand[g]! < tradeRatio(s, seat, g)) continue;
          for (let r = 0; r < 5; r++) if (r !== g && s.bank[r]! > 0) out.push({ t: 'bank', give: g, get: r });
        }
        out.push({ t: 'end' });
        break;
      }
    }
    return out;
  },

  validate: (s, seat, a): Result => {
    if (s.phase === 'over') return fail('Игра окончена');
    if (a.t === 'discard') {
      if (s.phase !== 'discard' || s.discardNeed[seat]! <= 0) return fail('Сбрасывать карты не нужно');
      if (a.cards.length !== 5 || !a.cards.every((c, i) => Number.isInteger(c) && c >= 0 && c <= s.hands[seat]![i]!)) return fail('Неверный набор карт');
      if (sum(a.cards) !== s.discardNeed[seat]) return fail(`Нужно сбросить ровно ${s.discardNeed[seat]}`);
      return ok(undefined);
    }
    if (a.t === 'offer') {
      if (seat !== s.turn || s.phase !== 'main' || s.offer) return fail('Сейчас нельзя предлагать обмен');
      if (s.offersLeft <= 0) return fail('Лимит предложений на ход исчерпан');
      const e = validOffer(s, seat, a);
      return e ? fail(e) : ok(undefined);
    }
    if (!catanGame.legalActions(s, seat).some((x) => same(x, a))) {
      return fail(seat !== s.turn && !s.offer ? 'Сейчас не ваш ход' : 'Недопустимое действие');
    }
    return ok(undefined);
  },

  apply: (prev, seat, a) => {
    const s = clone(prev);
    switch (a.t) {
      case 'build': {
        if (s.phase === 'setup') {
          if (a.what === 'settlement') {
            s.vOwner[a.at] = seat;
            s.vKind[a.at] = 1;
            s.lastSettle = a.at;
            s.setupStep = 'road';
            if (s.setupIdx >= s.players) {
              // Вторая расстановка: по одной карте с каждого соседнего гекса.
              for (const h of BOARD.verts[a.at]!.hexes) {
                const r = s.hexRes[h]!;
                if (r >= 0 && s.bank[r]! > 0) {
                  s.hands[seat]![r]!++;
                  s.bank[r]!--;
                }
              }
            }
            log(s, `${name(seat)} ставит поселение.`);
          } else {
            s.eOwner[a.at] = seat;
            s.setupIdx++;
            s.setupStep = 'settlement';
            if (s.setupIdx === 2 * s.players) {
              s.phase = 'roll';
              s.turn = 0;
              log(s, 'Расстановка закончена. Первый ход — Игрок 1.');
            } else s.turn = setupOrder(s.players, s.setupIdx);
          }
          return s;
        }
        if (a.what === 'road') {
          const free = s.phase === 'roads';
          if (!free) pay(s, seat, COST.road);
          s.eOwner[a.at] = seat;
          if (free) {
            s.freeRoads--;
            if (s.freeRoads <= 0 || roadSpots(s, seat).length === 0) resume(s);
          }
          updateLongest(s);
        } else if (a.what === 'settlement') {
          pay(s, seat, COST.settlement);
          s.vOwner[a.at] = seat;
          s.vKind[a.at] = 1;
          updateLongest(s); // поселение может разорвать чужую дорогу
          log(s, `${name(seat)} строит поселение.`);
        } else {
          pay(s, seat, COST.city);
          s.vKind[a.at] = 2;
          log(s, `${name(seat)} превращает поселение в город.`);
        }
        break;
      }
      case 'roll': {
        const rng = createRng(s.rng);
        const d: [number, number] = [rng.int(6) + 1, rng.int(6) + 1];
        s.rng = rng.state;
        s.dice = d;
        s.rolled = true;
        const total = d[0] + d[1];
        log(s, `${name(seat)} бросает кости: ${d[0]} + ${d[1]} = ${total}.`);
        if (total === 7) {
          s.discardNeed = s.hands.map((h) => (sum(h) > 7 ? Math.floor(sum(h) / 2) : 0));
          s.phase = s.discardNeed.some((n) => n > 0) ? 'discard' : 'robber';
        } else {
          produce(s, total);
          s.phase = 'main';
        }
        break;
      }
      case 'discard': {
        a.cards.forEach((c, r) => {
          s.hands[seat]![r]! -= c;
          s.bank[r]! += c;
        });
        s.discardNeed[seat] = 0;
        log(s, `${name(seat)} сбрасывает ${sum(a.cards)} карт.`);
        if (s.discardNeed.every((n) => n === 0)) s.phase = 'robber';
        return s;
      }
      case 'moveRobber': {
        s.robber = a.hex;
        const victims = robberVictims(s, a.hex);
        if (victims.length === 0) resume(s);
        else if (victims.length === 1) {
          stealCard(s, seat, victims[0]!);
          resume(s);
        } else {
          s.stealFrom = victims;
          s.phase = 'steal';
        }
        break;
      }
      case 'steal':
        stealCard(s, seat, a.from);
        s.stealFrom = [];
        resume(s);
        break;
      case 'buyDev': {
        pay(s, seat, COST.dev);
        const k = s.devDeck.pop()!;
        s.dev[seat]![k]!++;
        s.devNew[k]!++;
        log(s, `${name(seat)} покупает карту развития.`);
        break;
      }
      case 'playKnight': {
        s.dev[seat]![KNIGHT]!--;
        s.devPlayed = true;
        s.knights[seat]!++;
        log(s, `${name(seat)} играет «Рыцаря».`);
        const best = Math.max(...s.knights);
        if (s.knights[seat]! >= 3 && s.knights[seat]! === best && s.army !== seat && (s.army === -1 || s.knights[seat]! > s.knights[s.army]!)) {
          s.army = seat;
          log(s, `${name(seat)} получает «Самое большое войско».`);
        }
        s.phase = 'robber';
        break;
      }
      case 'playRoads':
        s.dev[seat]![ROADS]!--;
        s.devPlayed = true;
        s.freeRoads = Math.min(2, piecesLeft(s, seat).roads);
        s.phase = 'roads';
        log(s, `${name(seat)} играет «Строительство дорог».`);
        break;
      case 'playPlenty':
        s.dev[seat]![PLENTY]!--;
        s.devPlayed = true;
        for (const r of [a.a, a.b]) {
          s.hands[seat]![r]!++;
          s.bank[r]!--;
        }
        log(s, `${name(seat)} играет «Изобилие»: берёт ${RES[a.a]} и ${RES[a.b]}.`);
        break;
      case 'playMonopoly': {
        s.dev[seat]![MONO]!--;
        s.devPlayed = true;
        let got = 0;
        for (let p = 0; p < s.players; p++) {
          if (p === seat) continue;
          got += s.hands[p]![a.res]!;
          s.hands[seat]![a.res]! += s.hands[p]![a.res]!;
          s.hands[p]![a.res] = 0;
        }
        log(s, `${name(seat)} играет «Монополию» на «${RES[a.res]}»: собрано ${got}.`);
        break;
      }
      case 'bank': {
        const ratio = tradeRatio(s, seat, a.give);
        s.hands[seat]![a.give]! -= ratio;
        s.bank[a.give]! += ratio;
        s.hands[seat]![a.get]!++;
        s.bank[a.get]!--;
        log(s, `${name(seat)} меняет ${ratio} «${RES[a.give]}» на «${RES[a.get]}» с банком.`);
        break;
      }
      case 'offer': {
        s.offersLeft--;
        s.offer = { from: seat, give: a.give, get: a.get, responses: Array.from({ length: s.players }, (_, p) => (p === seat ? 2 : 0)) };
        log(s, `${name(seat)} предлагает обмен.`);
        return s;
      }
      case 'respond': {
        s.offer!.responses[seat] = a.accept ? 1 : 2;
        if (s.offer!.responses.every((r, p) => p === s.offer!.from || r === 2)) {
          s.offer = null;
          log(s, 'Никто не принял обмен.');
        }
        return s;
      }
      case 'confirm': {
        const o = s.offer!;
        for (let r = 0; r < 5; r++) {
          s.hands[o.from]![r]! += o.get[r]! - o.give[r]!;
          s.hands[a.with]![r]! += o.give[r]! - o.get[r]!;
        }
        s.offer = null;
        log(s, `${name(o.from)} и ${name(a.with)} обмениваются ресурсами.`);
        return s;
      }
      case 'cancel':
        s.offer = null;
        log(s, 'Предложение обмена отозвано.');
        return s;
      case 'end': {
        s.turn = (s.turn + 1) % s.players;
        s.rolled = false;
        s.devPlayed = false;
        s.devNew = [0, 0, 0, 0, 0];
        s.offer = null;
        s.offersLeft = 3;
        s.dice = null;
        s.phase = 'roll';
        s.turnCount++;
        return s;
      }
    }
    checkWin(s);
    return s;
  },

  outcome: (s): Outcome | null => {
    if (s.phase !== 'over' || s.winner === null) return null;
    const pts = Array.from({ length: s.players }, (_, p) => totalVp(s, p));
    const order = pts.map((_, i) => i).sort((x, y) => (y === s.winner ? 1 : 0) - (x === s.winner ? 1 : 0) || pts[y]! - pts[x]! || x - y);
    return { winners: [s.winner], ranking: order, reason: 'victory', scores: Object.fromEntries(pts.map((v, i) => [i, v])) };
  },

  view: (s, seat) => {
    const { hands, dev, devNew, devDeck, rng: _rng, ...pub } = s;
    const over = s.phase === 'over';
    return {
      ...pub,
      hand: seat === null ? null : hands[seat]!,
      handCounts: hands.map(sum),
      myDev: seat === null ? null : dev[seat]!,
      myDevNew: seat === null ? null : devNew,
      devCounts: dev.map(sum),
      devDeckCount: devDeck.length,
      vp: s.hands.map((_, p) => (over ? totalVp(s, p) : publicVp(s, p))),
      myVp: seat === null ? null : totalVp(s, seat),
      roadLens: s.hands.map((_, p) => roadLength(s, p)),
      finished: over,
    };
  },

  redactAction: (a, actor, viewer) => {
    // Сброс карт и предложения не раскрывают состав руки лишнего: оставляем только факт действия.
    if (a.t === 'discard' && viewer !== actor) return { t: 'discard', cards: [0, 0, 0, 0, 0] };
    return a;
  },

  timeoutAction: (s, seat) => {
    const legal = catanGame.legalActions(s, seat);
    const pick = (t: CatanAction['t']) => legal.find((x) => x.t === t);
    if (s.offer) return seat === s.offer.from ? { t: 'cancel' } : { t: 'respond', accept: false };
    if (s.phase === 'main') return { t: 'end' };
    if (s.phase === 'roads') return legal[0] ? legal[0] : { t: 'end' };
    return pick('roll') ?? chooseBot(s, seat, { level: 'EASY', rngSeed: `timeout-${s.turnCount}-${s.log.length}` });
  },

  chooseBotAction: (s, seat, bot) => chooseBot(s, seat, bot),
};

// ───────── бот ─────────

/** Ценность вершины для поселения: точки жетонов, разнообразие ресурсов, гавани. */
export function vertexValue(s: CatanState, v: number, p: Seat): number {
  const have = new Set<number>();
  for (let h = 0; h < HEX_COUNT; h++) {
    if (s.hexRes[h]! < 0) continue;
    if (BOARD.hexes[h]!.verts.some((x) => s.vOwner[x] === p)) have.add(s.hexRes[h]!);
  }
  let val = 0;
  const seen = new Set<number>();
  for (const h of BOARD.verts[v]!.hexes) {
    const r = s.hexRes[h]!;
    if (r < 0) continue;
    val += PIPS[s.hexNum[h]!]! * (have.has(r) ? 0.8 : 1.15);
    seen.add(r);
  }
  val += seen.size * 0.6;
  s.ports.forEach((type, slot) => {
    const e = BOARD.edges[BOARD.portEdges[slot]!]!;
    if (e.a === v || e.b === v) val += type === GENERIC_PORT ? 1.2 : 1.8;
  });
  return val;
}

function hexThreat(s: CatanState, h: number, p: Seat): number {
  let v = 0;
  for (const x of BOARD.hexes[h]!.verts) {
    const o = s.vOwner[x]!;
    if (o < 0) continue;
    const w = PIPS[s.hexNum[h]!]! * s.vKind[x]!;
    v += o === p ? -w * 1.5 : w * (1 + publicVp(s, o) / 10);
  }
  return v;
}

function chooseBot(s: CatanState, seat: Seat, bot: BotContext): CatanAction {
  const legal = catanGame.legalActions(s, seat);
  const rng = createRng(bot.rngSeed);
  const noise = bot.level === 'EASY' ? 3 : bot.level === 'MEDIUM' ? 1 : bot.level === 'HARD' ? 0.3 : 0;
  const first = <T extends CatanAction['t']>(t: T) => legal.find((x) => x.t === t) as Extract<CatanAction, { t: T }> | undefined;
  const fallback = (): CatanAction => legal[rng.int(legal.length)]!;
  if (legal.length === 0) return { t: 'end' };
  if (bot.level === 'EASY' && rng.next() < 0.25 && s.phase !== 'discard') return s.phase === 'main' && rng.next() < 0.5 ? { t: 'end' } : fallback();

  // Ответ на чужое предложение / собственное предложение
  if (s.offer) {
    if (seat === s.offer.from) return legal.find((x) => x.t === 'confirm') ?? { t: 'cancel' };
    const o = s.offer;
    const hand = s.hands[seat]!;
    const wantsIt = o.give.some((g, r) => g > 0 && hand[r]! === 0) && o.get.every((g, r) => g === 0 || hand[r]! - g >= 1);
    return legal.some((x) => x.t === 'respond' && x.accept) && wantsIt && bot.level !== 'EASY' ? { t: 'respond', accept: true } : { t: 'respond', accept: false };
  }

  switch (s.phase) {
    case 'setup': {
      if (s.setupStep === 'settlement') {
        let best = legal[0]!;
        let bv = -1e9;
        for (const a of legal) {
          if (a.t !== 'build') continue;
          const v = vertexValue(s, a.at, seat) + rng.next() * noise;
          if (v > bv) [best, bv] = [a, v];
        }
        return best;
      }
      // Дорога — в сторону лучшей свободной вершины
      let best = legal[0]!;
      let bv = -1e9;
      for (const a of legal) {
        if (a.t !== 'build') continue;
        const ed = BOARD.edges[a.at]!;
        const far = ed.a === s.lastSettle ? ed.b : ed.a;
        let v = settleFree(s, far) ? vertexValue(s, far, seat) : 0;
        for (const n of BOARD.verts[far]!.adj) if (n !== s.lastSettle && settleFree(s, n)) v = Math.max(v, vertexValue(s, n, seat) * 0.8);
        v += rng.next() * noise;
        if (v > bv) [best, bv] = [a, v];
      }
      return best;
    }
    case 'roll': {
      const k = first('playKnight');
      if (k && bot.level !== 'EASY' && hexThreat(s, s.robber, seat) < -2) return k;
      return { t: 'roll' };
    }
    case 'discard':
      return legal[0]!;
    case 'robber': {
      let best = legal[0]!;
      let bv = -1e9;
      for (const a of legal) {
        if (a.t !== 'moveRobber') continue;
        const v = hexThreat(s, a.hex, seat) + rng.next() * noise * 2;
        if (v > bv) [best, bv] = [a, v];
      }
      return best;
    }
    case 'steal': {
      const st = legal.filter((x): x is Extract<CatanAction, { t: 'steal' }> => x.t === 'steal');
      st.sort((x, y) => publicVp(s, y.from) - publicVp(s, x.from));
      return st[0]!;
    }
    case 'roads':
    case 'main':
      break;
    default:
      return fallback();
  }

  // Строительство дороги (бесплатной или нет): выбираем ту, что ведёт к лучшей новой вершине
  const bestRoad = (): { a: CatanAction; v: number } | null => {
    let best: { a: CatanAction; v: number } | null = null;
    for (const a of legal) {
      if (a.t !== 'build' || a.what !== 'road') continue;
      const ed = BOARD.edges[a.at]!;
      let v = 0;
      for (const end of [ed.a, ed.b]) {
        if (s.vOwner[end] === seat || settleConnected(s, seat, end)) continue;
        if (settleFree(s, end)) v = Math.max(v, vertexValue(s, end, seat));
      }
      v += rng.next() * 0.5;
      if (!best || v > best.v) best = { a, v };
    }
    return best;
  };
  if (s.phase === 'roads') return bestRoad()?.a ?? { t: 'end' };

  const hand = s.hands[seat]!;
  const me = piecesLeft(s, seat);
  const pickBuild = (what: 'settlement' | 'city') => {
    let best: CatanAction | null = null;
    let bv = -1e9;
    for (const a of legal) {
      if (a.t !== 'build' || a.what !== what) continue;
      const v = vertexValue(s, a.at, seat) + rng.next() * noise;
      if (v > bv) [best, bv] = [a, v];
    }
    return best;
  };

  const city = pickBuild('city');
  if (city) return city;
  const settle = pickBuild('settlement');
  if (settle) return settle;
  // Карта развития: дорогие ресурсы остаются на города, поэтому покупаем при избытке
  if (legal.some((x) => x.t === 'buyDev') && (me.cities === 0 || me.settlements === MAX_SETTLEMENTS || sum(hand) >= 6 || bot.level === 'EASY')) return { t: 'buyDev' };
  // Игра карт развития
  const knight = first('playKnight');
  if (knight && (hexThreat(s, s.robber, seat) < 0 || s.knights[seat]! >= 1)) return knight;
  const pr = first('playRoads');
  if (pr) return pr;
  const pm = legal.filter((x): x is Extract<CatanAction, { t: 'playMonopoly' }> => x.t === 'playMonopoly');
  if (pm.length > 0 && sum(hand) <= 3) {
    // Монополия на ресурс, которого у нас меньше всего, а нужен для города
    let r = 3;
    for (const x of [3, 4, 0, 1, 2]) if (hand[x]! < hand[r]!) r = x;
    return pm.find((x) => x.res === r) ?? pm[0]!;
  }
  const pp = legal.filter((x): x is Extract<CatanAction, { t: 'playPlenty' }> => x.t === 'playPlenty');
  if (pp.length > 0) return pp.find((x) => (x.a === 3 && x.b === 4) || (x.a === 4 && x.b === 3)) ?? pp.find((x) => x.a === 3 || x.b === 4) ?? pp[0]!;
  // Обмен с банком ради цели
  const noSpots = settleSpots(s, seat).length === 0;
  const target =
    me.cities > 0 && citySpots(s, seat).length > 0 ? COST.city : !noSpots && me.settlements > 0 ? COST.settlement : noSpots && me.settlements > 0 && me.roads > 0 ? COST.road : COST.dev;
  const trades = legal.filter((x): x is Extract<CatanAction, { t: 'bank' }> => x.t === 'bank');
  const need = target.map((c, i) => Math.max(0, c - hand[i]!));
  if (sum(need) > 0) {
    for (const t of trades) {
      if (need[t.get]! > 0 && hand[t.give]! - tradeRatio(s, seat, t.give) >= target[t.give]!) {
        // не отдаём то, что нужно цели
        return t;
      }
    }
  }
  // Дорога: если уже есть планы на расширение и избыток дерева/глины
  if (me.roads > 0 && canAfford(hand, COST.road) && (noSpots || hand[0]! >= 3 || hand[1]! >= 3)) {
    const r = bestRoad();
    if (r && (noSpots || r.v > 2)) return r.a;
  }
  return { t: 'end' };
}
