import { createRng } from '../../core/rng';
import { fail, ok, type GameDefinition, type Outcome, type Seat } from '../../core/types';
import { BUNKERS, CATASTROPHES, CATEGORIES, POOLS, SEXES, type Category } from './data';

export * from './data';

/**
 * Бункер. Каждому достаётся набор карт (пол и возраст, профессия, здоровье, хобби, багаж, факт, фобия).
 * Раунд: все открывают по одной карте → обсуждение → голосование, изгнанный покидает игру.
 * В бункер попадает половина игроков (округляя вверх). Выжившие — победители.
 */
export interface BunkerState {
  players: number;
  catastrophe: string;
  bunker: string;
  capacity: number;
  /** Карты игроков: категория → текст; 'person' — пол и возраст. */
  cards: Record<string, string>[];
  /** Открытые карты игроков. */
  open: Record<string, boolean>[];
  alive: boolean[];
  exiledOrder: Seat[];
  phase: 'reveal' | 'discuss' | 'vote' | 'revote';
  round: number;
  ready: boolean[];
  votes: Record<number, number>;
  /** Если голоса разделились — кандидатов на переголосование. */
  candidates: Seat[];
  log: string[];
  rng: number;
  finished: boolean;
}

export type BunkerAction =
  | { t: 'reveal'; cat: Category | 'person' }
  | { t: 'ready' }
  | { t: 'vote'; target: number };

export interface BunkerView {
  players: number;
  catastrophe: string;
  bunker: string;
  capacity: number;
  /** Для каждого игрока: открытые карты (себе — все, с пометкой что открыто). */
  cards: Record<string, string | null>[];
  open: Record<string, boolean>[];
  alive: boolean[];
  phase: BunkerState['phase'];
  round: number;
  acted: boolean[];
  candidates: Seat[];
  log: string[];
  finished: boolean;
}

const clone = (s: BunkerState): BunkerState => JSON.parse(JSON.stringify(s)) as BunkerState;
const aliveSeats = (s: BunkerState) => s.alive.map((a, i) => (a ? i : -1)).filter((i) => i >= 0);
const name = (seat: Seat) => `Игрок ${seat + 1}`;
const log = (s: BunkerState, t: string) => {
  s.log.push(t);
  if (s.log.length > 40) s.log.shift();
};
const ALL: (Category | 'person')[] = ['person', ...CATEGORIES];

const hasUnopened = (s: BunkerState, seat: Seat) => ALL.some((c) => !s.open[seat]![c]);

/** Начало раунда: все живые должны открыть карту. */
function startRound(s: BunkerState) {
  s.round++;
  s.phase = 'reveal';
  s.ready = Array(s.players).fill(false);
  s.votes = {};
  s.candidates = [];
  for (const i of aliveSeats(s)) if (!hasUnopened(s, i)) s.ready[i] = true; // страховка: открывать больше нечего
}

export const bunkerGame: GameDefinition<BunkerState, BunkerAction, BunkerView> = {
  slug: 'bunker',
  minPlayers: 4,
  maxPlayers: 12,

  setup: ({ players, seed }) => {
    const rng = createRng(seed);
    const pick = (cat: Category) => POOLS[cat];
    // Карты одной категории не повторяются между игроками, пока хватает.
    const decks = Object.fromEntries(CATEGORIES.map((c) => [c, rng.shuffle(pick(c))])) as Record<Category, string[]>;
    const cards = Array.from({ length: players }, () => {
      const person = `${SEXES[rng.int(2)]}, ${18 + rng.int(60)} лет`;
      const card: Record<string, string> = { person };
      for (const c of CATEGORIES) card[c] = decks[c].pop() ?? POOLS[c][rng.int(POOLS[c].length)]!;
      return card;
    });
    const s: BunkerState = {
      players, catastrophe: CATASTROPHES[rng.int(CATASTROPHES.length)]!, bunker: BUNKERS[rng.int(BUNKERS.length)]!,
      capacity: Math.ceil(players / 2), cards, open: Array.from({ length: players }, () => ({})), alive: Array(players).fill(true),
      exiledOrder: [], phase: 'reveal', round: 0, ready: Array(players).fill(false), votes: {}, candidates: [],
      log: ['Катастрофа случилась. Нужно решить, кто войдёт в бункер.'], rng: rng.state, finished: false,
    };
    startRound(s);
    return s;
  },

  currentSeats: (s) => {
    if (s.finished) return [];
    const alive = aliveSeats(s);
    if (s.phase === 'reveal') return alive.filter((i) => !s.ready[i]);
    if (s.phase === 'discuss') return alive.filter((i) => !s.ready[i]);
    return alive.filter((i) => s.votes[i] === undefined);
  },

  legalActions: (s, seat) => {
    if (!bunkerGame.currentSeats(s).includes(seat)) return [];
    if (s.phase === 'reveal') {
      // В первом раунде сначала открывается профессия.
      const free = ALL.filter((c) => !s.open[seat]![c]);
      const options = s.round === 1 && !s.open[seat]!.profession ? ['profession' as const] : free;
      return options.map((cat): BunkerAction => ({ t: 'reveal', cat }));
    }
    if (s.phase === 'discuss') return [{ t: 'ready' }];
    const targets = s.phase === 'revote' ? s.candidates : aliveSeats(s);
    return targets.filter((t) => t !== seat).map((target): BunkerAction => ({ t: 'vote', target }));
  },

  validate: (s, seat, a) => {
    if (s.finished) return fail('Игра окончена');
    if (!bunkerGame.currentSeats(s).includes(seat)) return fail('Сейчас вы не действуете');
    const act = a as BunkerAction | null;
    const legal = bunkerGame.legalActions(s, seat);
    if (!act || !legal.some((x) => x.t === act.t && ('cat' in x ? x.cat === (act as { cat?: string }).cat : 'target' in x ? x.target === (act as { target?: number }).target : true))) {
      return fail('Это действие сейчас недоступно');
    }
    return ok(undefined);
  },

  apply: (prev, seat, a) => {
    const s = clone(prev);
    if (a.t === 'reveal') {
      s.open[seat]![a.cat] = true;
      s.ready[seat] = true;
      log(s, `${name(seat)} открывает «${a.cat === 'person' ? 'пол и возраст' : { profession: 'профессию', health: 'здоровье', hobby: 'хобби', baggage: 'багаж', fact: 'факт', phobia: 'фобию' }[a.cat]}»: ${s.cards[seat]![a.cat]}.`);
      if (aliveSeats(s).every((i) => s.ready[i])) {
        s.phase = 'discuss';
        s.ready = Array(s.players).fill(false);
        log(s, 'Обсуждение: кто достоин места в бункере?');
      }
      return s;
    }
    if (a.t === 'ready') {
      s.ready[seat] = true;
      if (aliveSeats(s).every((i) => s.ready[i])) {
        s.phase = 'vote';
        s.votes = {};
        log(s, 'Голосование за изгнание.');
      }
      return s;
    }
    s.votes[seat] = a.target;
    if (!aliveSeats(s).every((i) => s.votes[i] !== undefined)) return s;

    // Подсчёт голосов
    const tally = new Map<number, number>();
    for (const t of Object.values(s.votes)) tally.set(t, (tally.get(t) ?? 0) + 1);
    const max = Math.max(...tally.values());
    const leaders = [...tally.entries()].filter(([, c]) => c === max).map(([t]) => t).sort((x, y) => x - y);
    log(s, `Голоса: ${[...tally.entries()].sort((x, y) => y[1] - x[1]).map(([t, c]) => `${name(t)} — ${c}`).join(', ')}.`);
    let out: Seat | null = null;
    if (leaders.length === 1) out = leaders[0]!;
    else if (s.phase === 'vote') {
      s.phase = 'revote';
      s.candidates = leaders;
      s.votes = {};
      log(s, `Ничья между ${leaders.map(name).join(' и ')} — переголосование.`);
      return s;
    } else {
      const rng = createRng(s.rng);
      out = leaders[rng.int(leaders.length)]!; // второй раз ничья — решает жребий
      s.rng = rng.state;
      log(s, 'Снова ничья — решает жребий.');
    }
    s.alive[out] = false;
    s.exiledOrder.push(out);
    log(s, `${name(out)} покидает игру. Его карты: ${Object.values(s.cards[out]!).join('; ')}.`);
    for (const c of ALL) s.open[out]![c] = true;
    if (aliveSeats(s).length <= s.capacity) {
      s.finished = true;
      log(s, `В бункер попали: ${aliveSeats(s).map(name).join(', ')}.`);
      return s;
    }
    startRound(s);
    return s;
  },

  chatAllowed: (s, seat) => (s.finished ? true : s.alive[seat] === true),

  outcome: (s): Outcome | null => {
    if (!s.finished) return null;
    const winners = aliveSeats(s);
    return { winners, ranking: [...winners, ...[...s.exiledOrder].reverse()], reason: 'bunker' };
  },

  view: (s, seat) => ({
    players: s.players, catastrophe: s.catastrophe, bunker: s.bunker, capacity: s.capacity,
    cards: s.cards.map((c, i) => Object.fromEntries(ALL.map((k) => [k, i === seat || s.open[i]![k] || s.finished ? c[k]! : null]))),
    open: s.open, alive: s.alive, phase: s.phase, round: s.round,
    acted: s.alive.map((_, i) => (s.phase === 'reveal' || s.phase === 'discuss' ? s.ready[i]! : s.votes[i] !== undefined)),
    candidates: s.candidates, log: s.log, finished: s.finished,
  }),

  timeoutAction: (s, seat) => {
    if (s.phase === 'reveal') {
      const legal = bunkerGame.legalActions(s, seat);
      return legal[0] ?? { t: 'ready' };
    }
    if (s.phase === 'discuss') return { t: 'ready' };
    // Не проголосовал: голос против случайного кандидата (первого доступного), чтобы раунд не завис.
    const targets = bunkerGame.legalActions(s, seat);
    return targets[0] ?? { t: 'ready' };
  },
};

export { hasUnopened };
