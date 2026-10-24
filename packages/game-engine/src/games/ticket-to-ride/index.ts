import { createRng } from '../../core/rng';
import { fail, ok, type BotContext, type GameDefinition, type Outcome, type Seat } from '../../core/types';
import { ANY, CITIES, LOCO, ROUTES, ROUTE_POINTS, TICKETS, distances, type Route } from './map';

export * from './map';

/**
 * «Билет на поезд» на схеме «Россия». 2–5 игроков, у каждого по 45 вагонов.
 * В свой ход — одно из: взять 2 карты вагонов, занять маршрут, взять билеты. Когда у кого-то остаётся ≤2 вагонов,
 * все остальные делают по одному последнему ходу. При 2–3 игроках второй маршрут двойной пары занимать нельзя.
 */
export const TRAINS = 45;
export const FACE_UP = 5;
export const LONGEST_BONUS = 10;

export interface TtrState {
  players: number;
  deck: number[];
  discard: number[];
  faceUp: number[];
  /** hands[игрок][тип карты 0…8] — число карт; 8 — локомотивы. */
  hands: number[][];
  /** Оставленные билеты (индексы в TICKETS). */
  tickets: number[][];
  ticketDeck: number[];
  /** Предложенные игроку билеты (ждут выбора). */
  pending: (number[] | null)[];
  pendingMin: number[];
  owner: number[];
  trains: number[];
  scores: number[];
  turn: Seat;
  /** Сколько карт уже взято в этом ходу (0 или 1). */
  drawn: 0 | 1;
  phase: 'init' | 'play';
  endTrigger: Seat | null;
  log: string[];
  rng: number;
  finished: boolean;
  final: { tickets: number[]; longest: number[]; longestBonus: number[] } | null;
}

export type TtrAction =
  | { t: 'drawDeck' }
  | { t: 'drawFaceUp'; idx: number }
  | { t: 'claim'; route: number; color: number; locos: number }
  | { t: 'drawTickets' }
  | { t: 'keepTickets'; keep: number[] };

export interface TtrView extends Omit<TtrState, 'deck' | 'ticketDeck' | 'hands' | 'tickets' | 'pending' | 'discard' | 'rng' | 'pendingMin'> {
  hand: number[];
  handCounts: number[];
  myTickets: number[];
  ticketCounts: number[];
  pending: number[] | null;
  pendingMin: number;
  deckCount: number;
  ticketDeckCount: number;
  completed: boolean[];
}

const clone = (s: TtrState): TtrState => JSON.parse(JSON.stringify(s)) as TtrState;
const name = (seat: Seat) => `Игрок ${seat + 1}`;
const log = (s: TtrState, t: string) => {
  s.log.push(t);
  if (s.log.length > 14) s.log.shift();
};
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

function drawFromDeck(s: TtrState, rng: ReturnType<typeof createRng>): number | null {
  if (s.deck.length === 0 && s.discard.length) {
    s.deck = rng.shuffle(s.discard);
    s.discard = [];
  }
  return s.deck.length ? (s.deck.pop() as number) : null;
}

/** Выкладывает открытые карты; если среди них три локомотива и больше — все сбрасываются и выкладываются заново. */
function refillFaceUp(s: TtrState) {
  const rng = createRng(s.rng);
  for (let guard = 0; guard < 10; guard++) {
    while (s.faceUp.length < FACE_UP) {
      const c = drawFromDeck(s, rng);
      if (c === null) break;
      s.faceUp.push(c);
    }
    if (s.faceUp.filter((c) => c === LOCO).length >= 3 && s.deck.length + s.discard.length >= 3) {
      s.discard.push(...s.faceUp);
      s.faceUp = [];
    } else break;
  }
  s.rng = rng.state;
}

export function routePoints(len: number): number {
  return ROUTE_POINTS[len] ?? 0;
}

/** Связность: выполнен ли билет (объединяем маршруты игрока). */
export function ticketDone(s: TtrState, seat: Seat, ticketId: number): boolean {
  const t = TICKETS[ticketId]!;
  const parent = CITIES.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  ROUTES.forEach((r, i) => {
    if (s.owner[i] === seat) parent[find(r.a)] = find(r.b);
  });
  return find(t.a) === find(t.b);
}

/** Длина самого длинного непрерывного пути (маршрут можно использовать один раз). */
export function longestPath(s: TtrState, seat: Seat): number {
  const edges = ROUTES.map((r, i) => ({ r, i })).filter(({ i }) => s.owner[i] === seat);
  const used = new Set<number>();
  let best = 0;
  const dfs = (city: number, len: number) => {
    best = Math.max(best, len);
    for (const { r, i } of edges) {
      if (used.has(i) || (r.a !== city && r.b !== city)) continue;
      used.add(i);
      dfs(r.a === city ? r.b : r.a, len + r.length);
      used.delete(i);
    }
  };
  for (const c of new Set(edges.flatMap(({ r }) => [r.a, r.b]))) dfs(c, 0);
  return best;
}

/** Можно ли занять маршрут `i` игроку: свободен, двойник не занят (≤3 игроков) и не мной, хватает вагонов. */
export function routeFree(s: TtrState, seat: Seat, i: number): boolean {
  const r = ROUTES[i]!;
  if (s.owner[i] !== -1 || s.trains[seat]! < r.length) return false;
  if (r.twin !== undefined) {
    const owner = s.owner[r.twin]!;
    if (owner === seat) return false; // оба параллельных маршрута одному игроку не достаются
    if (owner !== -1 && s.players <= 3) return false;
  }
  return true;
}

/** Варианты оплаты маршрута из руки: цвет и минимально необходимое число локомотивов. */
export function payments(hand: number[], route: Route): { color: number; locos: number }[] {
  const colors = route.color === ANY ? [0, 1, 2, 3, 4, 5, 6, 7] : [route.color];
  const out: { color: number; locos: number }[] = [];
  let allLoco = false;
  for (const color of colors) {
    const need = route.length - Math.min(hand[color]!, route.length);
    if (need > hand[LOCO]!) continue;
    if (need === route.length) {
      // Оплата только локомотивами одинакова для любого цвета — показываем один раз.
      if (allLoco) continue;
      allLoco = true;
    }
    out.push({ color, locos: need });
  }
  return out;
}

export const ttrGame: GameDefinition<TtrState, TtrAction, TtrView> = {
  slug: 'ticket-to-ride',
  minPlayers: 2,
  maxPlayers: 5,

  setup: ({ players, seed }) => {
    const rng = createRng(seed);
    const deck = rng.shuffle<number>([...Array.from({ length: 96 }, (_, i) => i % 8), ...Array<number>(14).fill(LOCO)]);
    const ticketDeck = rng.shuffle(TICKETS.map((_, i) => i));
    const s: TtrState = {
      players, deck, discard: [], faceUp: [], hands: Array.from({ length: players }, () => Array(9).fill(0)),
      tickets: Array.from({ length: players }, () => []), ticketDeck, pending: Array(players).fill(null), pendingMin: Array(players).fill(2),
      owner: Array(ROUTES.length).fill(-1), trains: Array(players).fill(TRAINS), scores: Array(players).fill(0), turn: 0, drawn: 0,
      phase: 'init', endTrigger: null, log: ['Игра началась. Каждый выбирает стартовые билеты.'], rng: rng.state, finished: false, final: null,
    };
    for (let p = 0; p < players; p++) {
      for (let i = 0; i < 4; i++) s.hands[p]![s.deck.pop() as number]!++;
      s.pending[p] = [s.ticketDeck.pop() as number, s.ticketDeck.pop() as number, s.ticketDeck.pop() as number];
    }
    refillFaceUp(s);
    return s;
  },

  currentSeats: (s) => {
    if (s.finished) return [];
    if (s.phase === 'init') return s.pending.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
    return [s.turn];
  },

  legalActions: (s, seat) => {
    if (!ttrGame.currentSeats(s).includes(seat)) return [];
    const pend = s.pending[seat];
    if (pend) {
      // Любое непустое подмножество, достаточное по минимуму.
      const acts: TtrAction[] = [];
      for (let mask = 1; mask < 1 << pend.length; mask++) {
        const keep = pend.map((_, i) => i).filter((i) => mask & (1 << i));
        if (keep.length >= s.pendingMin[seat]!) acts.push({ t: 'keepTickets', keep });
      }
      return acts;
    }
    const acts: TtrAction[] = [];
    if (s.deck.length + s.discard.length > 0) acts.push({ t: 'drawDeck' });
    s.faceUp.forEach((c, idx) => {
      if (c === LOCO && s.drawn === 1) return; // вторым ходом локомотив из открытых брать нельзя
      acts.push({ t: 'drawFaceUp', idx });
    });
    if (s.drawn === 0) {
      ROUTES.forEach((r, route) => {
        if (!routeFree(s, seat, route)) return;
        for (const p of payments(s.hands[seat]!, r)) acts.push({ t: 'claim', route, color: p.color, locos: p.locos });
      });
      if (s.ticketDeck.length > 0) acts.push({ t: 'drawTickets' });
    }
    return acts;
  },

  validate: (s, seat, a) => {
    if (s.finished) return fail('Игра окончена');
    if (!ttrGame.currentSeats(s).includes(seat)) return fail('Сейчас не ваш ход');
    const act = a as TtrAction | null;
    if (!act || typeof act !== 'object') return fail('Некорректное действие');
    const pend = s.pending[seat];
    if (pend) {
      if (act.t !== 'keepTickets') return fail('Сначала выберите билеты');
      const keep = act.keep;
      if (!Array.isArray(keep) || new Set(keep).size !== keep.length || keep.some((i) => !Number.isInteger(i) || i < 0 || i >= pend.length)) return fail('Некорректный выбор билетов');
      return keep.length >= s.pendingMin[seat]! ? ok(undefined) : fail(`Нужно оставить минимум ${s.pendingMin[seat]}`);
    }
    switch (act.t) {
      case 'drawDeck':
        return s.deck.length + s.discard.length > 0 ? ok(undefined) : fail('Колода пуста');
      case 'drawFaceUp': {
        const c = s.faceUp[act.idx];
        if (c === undefined) return fail('Нет такой карты');
        return c === LOCO && s.drawn === 1 ? fail('Локомотив из открытых можно взять только первым') : ok(undefined);
      }
      case 'claim': {
        if (s.drawn === 1) return fail('Вы уже брали карту — возьмите вторую');
        const r = ROUTES[act.route];
        if (!r) return fail('Нет такого маршрута');
        if (!routeFree(s, seat, act.route)) return fail('Этот маршрут занять нельзя');
        if (!Number.isInteger(act.locos) || act.locos < 0 || act.locos > r.length) return fail('Некорректное число локомотивов');
        if (act.color < 0 || act.color > 7 || (r.color !== ANY && act.color !== r.color)) return fail('Нужны карты цвета маршрута');
        const need = r.length - act.locos;
        return s.hands[seat]![act.color]! >= need && s.hands[seat]![LOCO]! >= act.locos ? ok(undefined) : fail('Не хватает карт');
      }
      case 'drawTickets':
        return s.drawn === 0 && s.ticketDeck.length > 0 ? ok(undefined) : fail('Билеты сейчас брать нельзя');
      default:
        return fail('Недоступное действие');
    }
  },

  apply: (prev, seat, a) => {
    const s = clone(prev);
    const rng = createRng(s.rng);

    const endTurn = () => {
      s.drawn = 0;
      if (s.trains[seat]! <= 2 && s.endTrigger === null) {
        s.endTrigger = seat;
        log(s, `${name(seat)}: осталось ${s.trains[seat]} вагонов — все делают по последнему ходу!`);
      }
      // Передаём ход; у кого ходов нет совсем (колоды пусты, занять нечего) — тот пропускает.
      let next = (seat + 1) % s.players;
      for (let k = 0; k < s.players; k++) {
        if (s.endTrigger !== null && next === s.endTrigger) {
          finishGame(s);
          return;
        }
        s.turn = next;
        if (ttrGame.legalActions(s, next).length > 0) return;
        log(s, `${name(next)} пропускает ход: сделать нечего.`);
        next = (next + 1) % s.players;
      }
      finishGame(s); // ни у кого нет ходов — игра окончена
    };

    if (a.t === 'keepTickets') {
      const pend = s.pending[seat]!;
      s.tickets[seat]!.push(...a.keep.map((i) => pend[i]!));
      s.ticketDeck.unshift(...pend.filter((_, i) => !a.keep.includes(i))); // отвергнутые уходят под низ колоды
      s.pending[seat] = null;
      s.pendingMin[seat] = 1;
      log(s, `${name(seat)} оставляет билетов: ${a.keep.length}.`);
      if (s.phase === 'init') {
        if (s.pending.every((p) => p === null)) {
          s.phase = 'play';
          s.turn = 0;
          log(s, 'Начинает игрок 1.');
        }
      } else endTurn();
      s.rng = rng.state;
      return s;
    }

    if (a.t === 'drawTickets') {
      const take = Math.min(3, s.ticketDeck.length);
      s.pending[seat] = Array.from({ length: take }, () => s.ticketDeck.pop() as number);
      s.pendingMin[seat] = 1;
      return s;
    }

    if (a.t === 'claim') {
      const r = ROUTES[a.route]!;
      s.hands[seat]![a.color]! -= r.length - a.locos;
      s.hands[seat]![LOCO]! -= a.locos;
      for (let i = 0; i < r.length - a.locos; i++) s.discard.push(a.color);
      for (let i = 0; i < a.locos; i++) s.discard.push(LOCO);
      s.owner[a.route] = seat;
      s.trains[seat]! -= r.length;
      s.scores[seat]! += routePoints(r.length);
      log(s, `${name(seat)} занимает ${CITIES[r.a]!.name} — ${CITIES[r.b]!.name} (+${routePoints(r.length)}).`);
      s.rng = rng.state;
      endTurn();
      return s;
    }

    // Взятие карты
    let card: number | null;
    if (a.t === 'drawFaceUp') {
      card = s.faceUp[a.idx] as number;
      s.faceUp.splice(a.idx, 1);
      s.rng = rng.state;
      refillFaceUp(s);
    } else {
      card = drawFromDeck(s, rng);
      s.rng = rng.state;
    }
    if (card !== null) s.hands[seat]![card]!++;
    // Локомотив из открытых — весь ход; иначе нужна вторая карта.
    if ((a.t === 'drawFaceUp' && card === LOCO && s.drawn === 0) || s.drawn === 1) endTurn();
    else s.drawn = 1;
    // Если взять вторую карту уже нечем, ход заканчивается.
    if (s.drawn === 1 && s.deck.length + s.discard.length === 0 && s.faceUp.filter((c) => c !== LOCO).length === 0) endTurn();
    return s;
  },

  outcome: (s): Outcome | null => {
    if (!s.finished) return null;
    const order = s.scores.map((_, i) => i).sort((x, y) => s.scores[y]! - s.scores[x]! || x - y);
    const best = s.scores[order[0]!]!;
    return { winners: order.filter((i) => s.scores[i] === best), ranking: order, reason: 'points', scores: Object.fromEntries(s.scores.map((sc, i) => [i, sc])) };
  },

  view: (s, seat) => {
    const { deck, ticketDeck, hands, tickets, pending, discard: _d, rng: _r, pendingMin, ...pub } = s;
    return {
      ...pub, hand: seat === null ? [] : hands[seat]!, handCounts: hands.map(sum), myTickets: seat === null ? [] : tickets[seat]!,
      ticketCounts: tickets.map((t) => t.length), pending: seat === null ? null : pending[seat] ?? null, pendingMin: seat === null ? 1 : pendingMin[seat]!,
      deckCount: deck.length, ticketDeckCount: ticketDeck.length,
      completed: seat === null ? [] : tickets[seat]!.map((t) => ticketDone(s, seat, t)),
    };
  },

  timeoutAction: (s, seat) => {
    const legal = ttrGame.legalActions(s, seat);
    return legal.find((a) => a.t === 'keepTickets') ?? legal.find((a) => a.t === 'drawDeck') ?? legal[0] ?? null;
  },

  chooseBotAction: (s, seat, bot) => chooseBot(s, seat, bot),
};

function finishGame(s: TtrState) {
  const ticketPts = s.tickets.map((ts, p) => ts.reduce((n, id) => n + (ticketDone(s, p, id) ? TICKETS[id]!.points : -TICKETS[id]!.points), 0));
  const longest = s.scores.map((_, p) => longestPath(s, p));
  const top = Math.max(...longest);
  const longestBonus = longest.map((l) => (l === top && top > 0 ? LONGEST_BONUS : 0));
  s.scores = s.scores.map((sc, p) => sc + ticketPts[p]! + longestBonus[p]!);
  s.final = { tickets: ticketPts, longest, longestBonus };
  s.finished = true;
  log(s, 'Игра окончена: подсчёт билетов и самого длинного пути.');
}

// ───────── бот ─────────

const DIST = distances();

/** Стоимость достройки пути между городами с учётом уже занятых мной маршрутов (кратчайший путь по весам). */
function pathPlan(s: TtrState, seat: Seat, a: number, b: number): { cost: number; routes: number[] } {
  const n = CITIES.length;
  const dist = Array<number>(n).fill(Infinity);
  const prev: { city: number; route: number }[] = Array.from({ length: n }, () => ({ city: -1, route: -1 }));
  const done = Array<boolean>(n).fill(false);
  dist[a] = 0;
  for (let k = 0; k < n; k++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && (u === -1 || dist[i]! < dist[u]!)) u = i;
    if (u === -1 || dist[u] === Infinity) break;
    done[u] = true;
    ROUTES.forEach((r, i) => {
      if (r.a !== u && r.b !== u) return;
      if (s.owner[i] !== -1 && s.owner[i] !== seat) return; // чужие маршруты недоступны
      const w = s.owner[i] === seat ? 0 : r.length;
      const v = r.a === u ? r.b : r.a;
      if (dist[u]! + w < dist[v]!) {
        dist[v] = dist[u]! + w;
        prev[v] = { city: u, route: i };
      }
    });
  }
  const routes: number[] = [];
  for (let c = b; c !== a && prev[c]!.city !== -1; c = prev[c]!.city) if (s.owner[prev[c]!.route] !== seat) routes.push(prev[c]!.route);
  return { cost: dist[b]!, routes };
}

function chooseBot(s: TtrState, seat: Seat, bot: BotContext): TtrAction {
  const legal = ttrGame.legalActions(s, seat);
  const rng = createRng(bot.rngSeed);
  if (bot.level === 'EASY' && rng.next() < 0.35) return legal[rng.int(legal.length)]!;

  // Выбор билетов: оставляем лучшие по отношению очков к стоимости.
  const pend = s.pending[seat];
  if (pend) {
    const scored = pend.map((id, i) => {
      const t = TICKETS[id]!;
      return { i, v: t.points / Math.max(1, pathPlan(s, seat, t.a, t.b).cost) };
    }).sort((x, y) => y.v - x.v);
    const min = s.pendingMin[seat]!;
    const keep = scored.filter((x, k) => k < min || x.v > 1.0).map((x) => x.i).sort((x, y) => x - y);
    return legal.find((a) => a.t === 'keepTickets' && a.keep.join() === keep.join()) ?? legal[0]!;
  }

  // Цели: маршруты, нужные для невыполненных билетов.
  const wanted = new Map<number, number>();
  for (const id of s.tickets[seat]!) {
    if (ticketDone(s, seat, id)) continue;
    const t = TICKETS[id]!;
    for (const r of pathPlan(s, seat, t.a, t.b).routes) wanted.set(r, (wanted.get(r) ?? 0) + 1);
  }

  const claims = legal.filter((a): a is Extract<TtrAction, { t: 'claim' }> => a.t === 'claim');
  if (claims.length) {
    const val = (c: Extract<TtrAction, { t: 'claim' }>) => {
      const r = ROUTES[c.route]!;
      return (wanted.get(c.route) ?? 0) * 6 + routePoints(r.length) - c.locos * 1.5 + (wanted.size === 0 ? r.length * 0.3 : 0);
    };
    const best = claims.slice().sort((x, y) => val(y) - val(x))[0]!;
    // Занимаем нужный маршрут сразу; ненужный — только если нет планов или мало карт для лучшего.
    if (wanted.has(best.route) || wanted.size === 0 || s.trains[seat]! <= 8) return best;
  }

  // Добор билетов, когда все выполнены, а вагонов ещё много.
  if (wanted.size === 0 && s.trains[seat]! > 18 && legal.some((a) => a.t === 'drawTickets') && s.tickets[seat]!.length < 6) return { t: 'drawTickets' };

  // Берём карты нужных цветов.
  const needColors = new Set<number>();
  for (const route of wanted.keys()) {
    const r = ROUTES[route]!;
    if (r.color !== ANY) needColors.add(r.color);
  }
  const hand = s.hands[seat]!;
  const faceUp = legal.filter((a): a is Extract<TtrAction, { t: 'drawFaceUp' }> => a.t === 'drawFaceUp');
  const pick = faceUp
    .map((a) => {
      const c = s.faceUp[a.idx]!;
      return { a, v: (needColors.has(c) ? 3 : 0) + (c === LOCO ? (s.drawn === 0 ? 2.5 : -9) : 0) + (hand[c]! > 1 ? 1 : 0) };
    })
    .sort((x, y) => y.v - x.v)[0];
  if (pick && pick.v >= 2) return pick.a;
  return legal.find((a) => a.t === 'drawDeck') ?? pick?.a ?? legal[0]!;
}

export { DIST };
