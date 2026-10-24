import { createRng } from '../../core/rng';
import { fail, ok, type BotContext, type GameDefinition, type Outcome, type Result, type Seat } from '../../core/types';
import { featuresOf, sideTypeOf, START_TYPE, TILE_TYPES, type Feature } from './tiles';

export * from './tiles';

/**
 * Каркассон, 2–5 игроков. 72 плитки, у каждого по 7 последователей (миплов). Ход: взять плитку и приложить её
 * к уже выложенным (стороны должны совпадать), затем по желанию поставить последователя на одну из частей
 * только что положенной плитки (город, дорога, монастырь или поле), если на этой части (с учётом связанных
 * плиток) ещё никого нет. Завершённые города, дороги и монастыри приносят очки, последователи возвращаются.
 * В конце игры считаются незавершённые объекты и фермеры (3 очка за каждый завершённый город рядом с полем).
 */
export const MEEPLES = 7;
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

export interface Placed {
  x: number;
  y: number;
  type: number;
  rot: number;
}
export interface Meeple {
  player: Seat;
  /** Индекс в `placed`. */
  tile: number;
  feat: number;
}

export interface CarcState {
  players: number;
  placed: Placed[];
  meeples: Meeple[];
  meeplesLeft: number[];
  scores: number[];
  /** Оставшиеся плитки (порядок скрыт от игроков). */
  deck: number[];
  /** Плитка, которую нужно положить. */
  cur: number | null;
  turn: Seat;
  phase: 'tile' | 'meeple' | 'over';
  last: number;
  log: string[];
  /** Очки, набранные в конце игры (для показа). */
  finalPoints: number[] | null;
}

export type CarcAction =
  | { t: 'place'; x: number; y: number; rot: number }
  | { t: 'meeple'; feat: number }
  | { t: 'skip' };

export interface CarcView extends Omit<CarcState, 'deck'> {
  deckCount: number;
  finished: boolean;
}

const clone = (s: CarcState): CarcState => JSON.parse(JSON.stringify(s)) as CarcState;
const name = (seat: Seat) => `Игрок ${seat + 1}`;
const log = (s: CarcState, t: string) => {
  s.log.push(t);
  if (s.log.length > 12) s.log.shift();
};

// ───────── геометрия и компоненты ─────────

const keyOf = (x: number, y: number) => `${x},${y}`;
function gridOf(s: CarcState): Map<string, number> {
  const m = new Map<string, number>();
  s.placed.forEach((p, i) => m.set(keyOf(p.x, p.y), i));
  return m;
}

/** Все допустимые места и повороты для плитки данного типа. */
export function placements(s: CarcState, type: number): { x: number; y: number; rot: number }[] {
  const g = gridOf(s);
  const cells = new Set<string>();
  for (const p of s.placed) for (let d = 0; d < 4; d++) if (!g.has(keyOf(p.x + DX[d]!, p.y + DY[d]!))) cells.add(keyOf(p.x + DX[d]!, p.y + DY[d]!));
  const out: { x: number; y: number; rot: number }[] = [];
  for (const c of cells) {
    const [x, y] = c.split(',').map(Number) as [number, number];
    for (let rot = 0; rot < 4; rot++) {
      let okFit = true;
      for (let d = 0; d < 4 && okFit; d++) {
        const n = g.get(keyOf(x + DX[d]!, y + DY[d]!));
        if (n === undefined) continue;
        const np = s.placed[n]!;
        if (sideTypeOf(type, rot, d) !== sideTypeOf(np.type, np.rot, (d + 2) % 4)) okFit = false;
      }
      if (okFit) out.push({ x, y, rot });
    }
  }
  return out;
}

export interface Analysis {
  /** Корень компонента для узла (tile, feat). */
  root: (tile: number, feat: number) => number;
  /** Узлы компонентов: root → [tile, feat][]. */
  comps: Map<number, [number, number][]>;
  feature: (tile: number, feat: number) => Feature;
  grid: Map<string, number>;
}

/** Склеивает части плиток в объекты: города, дороги и поля через общие стороны. */
export function analyze(s: CarcState): Analysis {
  const base: number[] = [];
  let n = 0;
  const feats = s.placed.map((p) => featuresOf(p.type, p.rot));
  for (let i = 0; i < s.placed.length; i++) {
    base.push(n);
    n += feats[i]!.length;
  }
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]!]!;
      a = parent[a]!;
    }
    return a;
  };
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  const grid = gridOf(s);
  s.placed.forEach((p, i) => {
    feats[i]!.forEach((f, fi) => {
      if (f.kind === 'city' || f.kind === 'road') {
        for (const d of f.sides) {
          const ni = grid.get(keyOf(p.x + DX[d]!, p.y + DY[d]!));
          if (ni === undefined) continue;
          const nf = feats[ni]!.findIndex((g) => g.kind === f.kind && g.sides.includes((d + 2) % 4));
          if (nf >= 0) union(base[i]! + fi, base[ni]! + nf);
        }
      } else if (f.kind === 'field') {
        for (const j of f.slots) {
          const d = Math.floor(j / 3);
          const ni = grid.get(keyOf(p.x + DX[d]!, p.y + DY[d]!));
          if (ni === undefined) continue;
          const nj = 3 * ((d + 2) % 4) + (2 - (j % 3));
          const nf = feats[ni]!.findIndex((g) => g.kind === 'field' && g.slots.includes(nj));
          if (nf >= 0) union(base[i]! + fi, base[ni]! + nf);
        }
      }
    });
  });
  const comps = new Map<number, [number, number][]>();
  s.placed.forEach((_, i) => {
    feats[i]!.forEach((__, fi) => {
      const r = find(base[i]! + fi);
      if (!comps.has(r)) comps.set(r, []);
      comps.get(r)!.push([i, fi]);
    });
  });
  return { root: (t, f) => find(base[t]! + f), comps, feature: (t, f) => feats[t]![f]!, grid };
}

const tileCount = (nodes: [number, number][]) => new Set(nodes.map((x) => x[0])).size;

/** Закончен ли город/дорога: у всех сторон есть соседние плитки. */
function isComplete(s: CarcState, a: Analysis, nodes: [number, number][]): boolean {
  for (const [t, f] of nodes) {
    const ft = a.feature(t, f);
    if (ft.kind !== 'city' && ft.kind !== 'road') return false;
    const p = s.placed[t]!;
    for (const d of ft.sides) if (!a.grid.has(keyOf(p.x + DX[d]!, p.y + DY[d]!))) return false;
  }
  return true;
}
const shields = (a: Analysis, nodes: [number, number][]) => {
  // щит считается один раз на плитку (на плитке один город)
  const seen = new Set<number>();
  for (const [t, f] of nodes) if (a.feature(t, f).shield) seen.add(t);
  return seen.size;
};
const monasteryNeighbors = (s: CarcState, a: Analysis, tile: number) => {
  const p = s.placed[tile]!;
  let c = 0;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if ((dx || dy) && a.grid.has(keyOf(p.x + dx, p.y + dy))) c++;
  return c;
};

/** Очки за объект (завершённый или в конце игры). */
function valueOf(s: CarcState, a: Analysis, nodes: [number, number][], complete: boolean): number {
  const kind = a.feature(nodes[0]![0], nodes[0]![1]).kind;
  if (kind === 'city') return complete ? 2 * (tileCount(nodes) + shields(a, nodes)) : tileCount(nodes) + shields(a, nodes);
  if (kind === 'road') return tileCount(nodes);
  if (kind === 'monastery') return 1 + monasteryNeighbors(s, a, nodes[0]![0]);
  return 0;
}

const meeplesOn = (s: CarcState, a: Analysis, root: number) => s.meeples.filter((m) => a.root(m.tile, m.feat) === root);

/** Начисляет очки владельцам большинства; возвращает кому и сколько. */
function awardMajority(s: CarcState, ms: Meeple[], pts: number, label: string) {
  if (ms.length === 0 || pts <= 0) return;
  const cnt = new Array<number>(s.players).fill(0);
  for (const m of ms) cnt[m.player]!++;
  const max = Math.max(...cnt);
  const winners = cnt.map((c, p) => (c === max ? p : -1)).filter((p) => p >= 0);
  for (const p of winners) s.scores[p]! += pts;
  log(s, `${winners.map(name).join(' и ')} ${winners.length > 1 ? 'получают' : 'получает'} ${pts} оч. за ${label}.`);
}

const FEAT_LABEL: Record<string, string> = { city: 'город', road: 'дорогу', monastery: 'монастырь', field: 'поле' };

/** Подсчёт после хода: завершённые объекты, которых касается последняя плитка (и монастыри вокруг неё). */
function scoreTurn(s: CarcState) {
  const a = analyze(s);
  const done = new Set<number>();
  const lastTile = s.last;
  const p = s.placed[lastTile]!;
  const candidates: [number, number][] = [];
  featuresOf(p.type, p.rot).forEach((f, fi) => {
    if (f.kind === 'city' || f.kind === 'road') candidates.push([lastTile, fi]);
  });
  // монастыри: на самой плитке и на всех соседних
  s.placed.forEach((q, i) => {
    if (Math.abs(q.x - p.x) <= 1 && Math.abs(q.y - p.y) <= 1) {
      featuresOf(q.type, q.rot).forEach((f, fi) => {
        if (f.kind === 'monastery') candidates.push([i, fi]);
      });
    }
  });
  const removed = new Set<Meeple>();
  for (const [t, f] of candidates) {
    const root = a.root(t, f);
    if (done.has(root)) continue;
    done.add(root);
    const nodes = a.comps.get(root)!;
    const kind = a.feature(t, f).kind;
    const complete = kind === 'monastery' ? monasteryNeighbors(s, a, t) === 8 : isComplete(s, a, nodes);
    if (!complete) continue;
    const ms = meeplesOn(s, a, root);
    awardMajority(s, ms, valueOf(s, a, nodes, true), `завершённ${kind === 'road' ? 'ую' : kind === 'monastery' ? 'ый' : 'ый'} ${FEAT_LABEL[kind]}`);
    ms.forEach((m) => removed.add(m));
  }
  if (removed.size) {
    for (const m of removed) s.meeplesLeft[m.player]!++;
    s.meeples = s.meeples.filter((m) => !removed.has(m));
  }
}

/** Итоговый подсчёт незавершённых объектов и фермеров. */
function finalScoring(s: CarcState) {
  const before = [...s.scores];
  const a = analyze(s);
  // Завершённые города (для фермеров)
  const doneCity = new Map<number, boolean>();
  for (const [root, nodes] of a.comps) if (a.feature(nodes[0]![0], nodes[0]![1]).kind === 'city') doneCity.set(root, isComplete(s, a, nodes));
  for (const [root, nodes] of a.comps) {
    const ms = meeplesOn(s, a, root);
    if (ms.length === 0) continue;
    const kind = a.feature(nodes[0]![0], nodes[0]![1]).kind;
    if (kind === 'field') {
      const cities = new Set<number>();
      for (const [t, f] of nodes) for (const ci of a.feature(t, f).cities) {
        const cr = a.root(t, ci);
        if (doneCity.get(cr)) cities.add(cr);
      }
      awardMajority(s, ms, cities.size * 3, 'поле');
    } else awardMajority(s, ms, valueOf(s, a, nodes, false), `незавершённ${kind === 'road' ? 'ую' : 'ый'} ${FEAT_LABEL[kind]}`);
  }
  s.finalPoints = s.scores.map((x, i) => x - before[i]!);
}

/** Берёт следующую плитку, которую можно положить; негодные уходят в сброс. Колода пуста — игра окончена. */
function draw(s: CarcState) {
  while (s.deck.length > 0) {
    const t = s.deck.pop()!;
    if (placements(s, t).length > 0) {
      s.cur = t;
      s.phase = 'tile';
      return;
    }
    log(s, `Плитку «${TILE_TYPES[t]!.name}» некуда положить — она убирается из игры.`);
  }
  s.cur = null;
  s.phase = 'over';
  finalScoring(s);
  log(s, 'Плитки закончились: итоговый подсчёт.');
}

/** Куда можно поставить последователя: части последней плитки, не занятые в своём объекте. */
export function meepleOptions(s: CarcState): number[] {
  if (s.phase !== 'meeple' || s.meeplesLeft[s.turn]! <= 0) return [];
  const a = analyze(s);
  const p = s.placed[s.last]!;
  const out: number[] = [];
  featuresOf(p.type, p.rot).forEach((f, fi) => {
    if (meeplesOn(s, a, a.root(s.last, fi)).length === 0) out.push(fi);
    void f;
  });
  return out;
}

export const carcassonneGame: GameDefinition<CarcState, CarcAction, CarcView> = {
  slug: 'carcassonne',
  minPlayers: 2,
  maxPlayers: 5,

  setup: ({ players, seed }) => {
    const rng = createRng(seed);
    const all: number[] = [];
    TILE_TYPES.forEach((t, i) => {
      for (let k = 0; k < t.count - (i === START_TYPE ? 1 : 0); k++) all.push(i);
    });
    const s: CarcState = {
      players,
      placed: [{ x: 0, y: 0, type: START_TYPE, rot: 0 }],
      meeples: [],
      meeplesLeft: Array(players).fill(MEEPLES),
      scores: Array(players).fill(0),
      deck: rng.shuffle(all),
      cur: null,
      turn: 0,
      phase: 'tile',
      last: 0,
      log: ['Игра началась: выложите плитку и, если хотите, поставьте последователя.'],
      finalPoints: null,
    };
    draw(s);
    return s;
  },

  currentSeats: (s) => (s.phase === 'over' ? [] : [s.turn]),

  legalActions: (s, seat) => {
    if (seat !== s.turn || s.phase === 'over') return [];
    if (s.phase === 'tile') return placements(s, s.cur!).map((p) => ({ t: 'place', ...p }));
    return [...meepleOptions(s).map((feat): CarcAction => ({ t: 'meeple', feat })), { t: 'skip' }];
  },

  validate: (s, seat, a): Result => {
    if (s.phase === 'over') return fail('Игра окончена');
    if (seat !== s.turn) return fail('Сейчас не ваш ход');
    if (s.phase === 'tile') {
      if (a.t !== 'place') return fail('Сначала выложите плитку');
      return placements(s, s.cur!).some((p) => p.x === a.x && p.y === a.y && p.rot === a.rot) ? ok(undefined) : fail('Сюда плитку положить нельзя');
    }
    if (a.t === 'skip') return ok(undefined);
    if (a.t !== 'meeple') return fail('Поставьте последователя или пропустите');
    return meepleOptions(s).includes(a.feat) ? ok(undefined) : fail('Сюда последователя поставить нельзя');
  },

  apply: (prev, seat, a) => {
    const s = clone(prev);
    if (a.t === 'place') {
      s.placed.push({ x: a.x, y: a.y, type: s.cur!, rot: a.rot });
      s.last = s.placed.length - 1;
      s.cur = null;
      s.phase = 'meeple';
      if (meepleOptions(s).length === 0) return endTurn(s);
      return s;
    }
    if (a.t === 'meeple') {
      s.meeples.push({ player: seat, tile: s.last, feat: a.feat });
      s.meeplesLeft[seat]!--;
    }
    return endTurn(s);
  },

  outcome: (s): Outcome | null => {
    if (s.phase !== 'over') return null;
    const order = s.scores.map((_, i) => i).sort((x, y) => s.scores[y]! - s.scores[x]! || x - y);
    const best = s.scores[order[0]!]!;
    return {
      winners: order.filter((i) => s.scores[i] === best),
      ranking: order,
      reason: 'points',
      scores: Object.fromEntries(s.scores.map((v, i) => [i, v])),
    };
  },

  view: (s) => {
    const { deck, ...rest } = s;
    return { ...rest, deckCount: deck.length, finished: s.phase === 'over' };
  },

  timeoutAction: (s, seat) => {
    const l = carcassonneGame.legalActions(s, seat);
    return s.phase === 'meeple' ? { t: 'skip' } : (l[0] ?? null);
  },
  chooseBotAction: (s, seat, bot) => chooseBot(s, seat, bot),
};

function endTurn(s: CarcState): CarcState {
  scoreTurn(s);
  s.turn = (s.turn + 1) % s.players;
  draw(s);
  return s;
}

// ───────── бот ─────────

/** Потенциал последователя на объекте: сколько очков он вероятно принесёт. */
function potential(s: CarcState, a: Analysis, m: Meeple): number {
  const nodes = a.comps.get(a.root(m.tile, m.feat))!;
  const ft = a.feature(m.tile, m.feat);
  if (ft.kind === 'monastery') return (1 + monasteryNeighbors(s, a, m.tile)) * 0.7;
  if (ft.kind === 'field') {
    const cities = new Set<number>();
    for (const [t, f] of nodes) for (const ci of a.feature(t, f).cities) cities.add(a.root(t, ci));
    let done = 0;
    for (const c of cities) if (isComplete(s, a, a.comps.get(c)!)) done++;
    return (done * 3 + (cities.size - done) * 1.2) * 0.55;
  }
  const v = valueOf(s, a, nodes, true);
  // чем больше открытых концов, тем менее вероятно завершение
  let open = 0;
  for (const [t, f] of nodes) {
    const q = s.placed[t]!;
    for (const d of a.feature(t, f).sides) if (!a.grid.has(keyOf(q.x + DX[d]!, q.y + DY[d]!))) open++;
  }
  return v * (open <= 1 ? 0.9 : open === 2 ? 0.6 : open === 3 ? 0.35 : 0.2);
}

function evaluate(s: CarcState, me: Seat): number {
  const a = analyze(s);
  let v = s.scores[me]!;
  let others = 0;
  for (let p = 0; p < s.players; p++) if (p !== me) others += s.scores[p]!;
  v -= (others / Math.max(1, s.players - 1)) * 0.9;
  for (const m of s.meeples) {
    const pot = potential(s, a, m);
    v += m.player === me ? pot : -pot * 0.45;
  }
  v += s.meeplesLeft[me]! * 0.9;
  return v;
}

function chooseBot(s: CarcState, seat: Seat, bot: BotContext): CarcAction {
  const legal = carcassonneGame.legalActions(s, seat);
  const rng = createRng(bot.rngSeed);
  if (bot.level === 'EASY') {
    if (s.phase === 'meeple') return rng.next() < 0.45 ? legal[rng.int(legal.length)]! : { t: 'skip' };
    return legal[rng.int(legal.length)]!;
  }
  const noise = bot.level === 'MEDIUM' ? 1.5 : bot.level === 'HARD' ? 0.4 : 0;
  const play = (st: CarcState, a: CarcAction) => carcassonneGame.apply(st, seat, a);

  if (s.phase === 'meeple') {
    let best = legal[legal.length - 1]!; // skip
    let bv = -1e9;
    for (const a of legal) {
      const v = evaluate(play(s, a), seat) + rng.next() * noise;
      if (v > bv) [best, bv] = [a, v];
    }
    return best;
  }
  let best = legal[0]!;
  let bv = -1e9;
  for (const a of legal) {
    const s1 = play(s, a);
    // оцениваем лучший вариант последователя после этой укладки
    let v = -1e9;
    if (s1.phase === 'meeple' && s1.turn === seat) {
      for (const m of carcassonneGame.legalActions(s1, seat)) v = Math.max(v, evaluate(play(s1, m), seat));
    } else v = evaluate(s1, seat);
    v += rng.next() * noise;
    if (v > bv) [best, bv] = [a, v];
  }
  return best;
}
