import { createRng } from '../../core/rng';
import { fail, ok, type GameDefinition, type Outcome, type Seat } from '../../core/types';

/**
 * Свинтус (онлайн-версия). 3–6 игроков, в колоде по 4 карты каждого из N «зверей» (N = число игроков в раунде).
 * Все одновременно выбирают карту и передают её соседу слева. У кого собралась четвёрка — жмёт «Пятачок»;
 * остальные обязаны нажать следом, последний получает букву слова «СВИНТУС». Семь букв — вылет.
 *
 * Скорость реакции определяется порядком получения действий сервером: кто нажал позже — тот и последний.
 */
export const WORD = 'СВИНТУС';
export const HAND = 4;

export interface SvintusState {
  players: number;
  /** hands[seat] — ранги четырёх карт на руках (0…N−1). */
  hands: number[][];
  /** Выбранная для передачи карта (ранг) или null. */
  chosen: (number | null)[];
  /** Сколько букв накоплено у каждого (WORD.length — вылет). */
  letters: number[];
  out: boolean[];
  outOrder: Seat[];
  phase: 'pass' | 'race';
  /** Порядок нажатия «Пятачка» в текущей гонке. */
  race: Seat[];
  round: number;
  rng: number;
  log: string[];
  finished: boolean;
  winner: Seat | null;
}

export type SvintusAction = { t: 'pass'; rank: number } | { t: 'snout' };

export interface SvintusView {
  players: number;
  hand: number[];
  chosen: boolean[];
  letters: number[];
  out: boolean[];
  phase: 'pass' | 'race';
  race: Seat[];
  round: number;
  /** Сколько зверей (рангов) в раунде. */
  kinds: number;
  log: string[];
  finished: boolean;
  winner: Seat | null;
}

const clone = (s: SvintusState): SvintusState => JSON.parse(JSON.stringify(s)) as SvintusState;
const alive = (s: SvintusState) => Array.from({ length: s.players }, (_, i) => i).filter((i) => !s.out[i]);
const hasFour = (hand: number[]) => hand.length === HAND && hand.every((r) => r === hand[0]);
const log = (s: SvintusState, t: string) => {
  s.log.push(t);
  if (s.log.length > 6) s.log.shift();
};
const name = (seat: Seat) => `Игрок ${seat + 1}`;

function deal(s: SvintusState) {
  const rng = createRng(s.rng);
  const seats = alive(s);
  const deck = rng.shuffle(seats.flatMap((_, rank) => Array.from({ length: 4 }, () => rank)));
  s.rng = rng.state;
  s.hands = Array.from({ length: s.players }, () => []);
  for (const seat of seats) s.hands[seat] = deck.splice(0, HAND).sort((a, b) => a - b);
  s.chosen = Array(s.players).fill(null);
  s.phase = 'pass';
  s.race = [];
  s.round++;
}

export const svintusGame: GameDefinition<SvintusState, SvintusAction, SvintusView> = {
  slug: 'svintus',
  minPlayers: 3,
  maxPlayers: 6,

  setup: ({ players, seed }) => {
    const s: SvintusState = {
      players, hands: [], chosen: [], letters: Array(players).fill(0), out: Array(players).fill(false), outOrder: [],
      phase: 'pass', race: [], round: 0, rng: createRng(seed).state, log: ['Игра началась.'], finished: false, winner: null,
    };
    deal(s);
    return s;
  },

  currentSeats: (s) => {
    if (s.finished) return [];
    if (s.phase === 'race') return alive(s).filter((i) => !s.race.includes(i));
    return alive(s).filter((i) => s.chosen[i] === null);
  },

  legalActions: (s, seat) => {
    if (!svintusGame.currentSeats(s).includes(seat)) return [];
    if (s.phase === 'race') return [{ t: 'snout' }];
    const acts: SvintusAction[] = [...new Set(s.hands[seat]!)].map((rank) => ({ t: 'pass', rank }) as SvintusAction);
    if (hasFour(s.hands[seat]!)) acts.push({ t: 'snout' });
    return acts;
  },

  validate: (s, seat, a) => {
    if (s.finished) return fail('Партия завершена');
    if (!svintusGame.currentSeats(s).includes(seat)) return fail(s.phase === 'pass' ? 'Вы уже выбрали карту' : 'Вы уже нажали');
    const act = a as SvintusAction | null;
    if (!act || typeof act !== 'object') return fail('Некорректное действие');
    if (act.t === 'snout') {
      return s.phase === 'race' || hasFour(s.hands[seat]!) ? ok(undefined) : fail('Пятачок можно нажать, только собрав четыре одинаковые карты');
    }
    if (act.t === 'pass') {
      if (s.phase === 'race') return fail('Все уже должны жать на пятачок!');
      return s.hands[seat]!.includes(act.rank) ? ok(undefined) : fail('У вас нет такой карты');
    }
    return fail('Неизвестное действие');
  },

  apply: (prev, seat, a) => {
    const s = clone(prev);
    if (a.t === 'snout') {
      if (s.phase === 'pass') {
        s.phase = 'race';
        log(s, `${name(seat)} собрал четвёрку и жмёт на пятачок!`);
      }
      s.race.push(seat);
      if (s.race.length === alive(s).length) {
        const loser = s.race[s.race.length - 1]!;
        s.letters[loser]!++;
        log(s, `${name(loser)} опоздал и получает букву «${WORD[s.letters[loser]! - 1]}».`);
        if (s.letters[loser] === WORD.length) {
          s.out[loser] = true;
          s.outOrder.push(loser);
          log(s, `${name(loser)} набрал слово «${WORD}» и вылетает.`);
        }
        if (alive(s).length === 1) {
          s.finished = true;
          s.winner = alive(s)[0]!;
          return s;
        }
        deal(s);
      }
      return s;
    }

    s.chosen[seat] = a.rank;
    // Все выбрали — передаём карты соседу слева (по кольцу живых игроков).
    if (alive(s).every((i) => s.chosen[i] !== null)) {
      const seats = alive(s);
      const incoming = new Map<Seat, number>();
      seats.forEach((p, i) => incoming.set(seats[(i + 1) % seats.length]!, s.chosen[p]!));
      for (const p of seats) {
        const hand = s.hands[p]!;
        hand.splice(hand.indexOf(s.chosen[p]!), 1);
        hand.push(incoming.get(p)!);
        hand.sort((x, y) => x - y);
      }
      s.chosen = Array(s.players).fill(null);
    }
    return s;
  },

  outcome: (s): Outcome | null => {
    if (!s.finished) return null;
    const winner = s.winner as Seat;
    return { winners: [winner], ranking: [winner, ...[...s.outOrder].reverse()], reason: 'svintus' };
  },

  view: (s, seat) => ({
    players: s.players, hand: seat === null ? [] : s.hands[seat] ?? [], chosen: s.chosen.map((c) => c !== null), letters: s.letters,
    out: s.out, phase: s.phase, race: s.race, round: s.round, kinds: alive(s).length, log: s.log, finished: s.finished, winner: s.winner,
  }),

  timeoutAction: (s, seat) => {
    if (s.phase === 'race' || hasFour(s.hands[seat]!)) return { t: 'snout' };
    // Отдаём карту самого редкого вида на руках (чтобы не ломать собранные пары).
    const counts = new Map<number, number>();
    for (const r of s.hands[seat]!) counts.set(r, (counts.get(r) ?? 0) + 1);
    const rank = [...counts.entries()].sort((x, y) => x[1] - y[1] || x[0] - y[0])[0]![0];
    return { t: 'pass', rank };
  },

  chooseBotAction: (s, seat, bot) => {
    const rng = createRng(bot.rngSeed);
    if (s.phase === 'race' || hasFour(s.hands[seat]!)) return { t: 'snout' };
    const hand = s.hands[seat]!;
    const counts = new Map<number, number>();
    for (const r of hand) counts.set(r, (counts.get(r) ?? 0) + 1);
    // Иногда играем случайно (у лёгкого бота — часто): без этого одинаковые стратегии могут зациклиться.
    if (rng.next() < (bot.level === 'EASY' ? 0.35 : 0.12)) return { t: 'pass', rank: hand[rng.int(HAND)]! };
    // Отдаём карту самого редкого вида; среди равных — случайную.
    const min = Math.min(...counts.values());
    const rare = [...counts.entries()].filter(([, c]) => c === min).map(([r]) => r);
    return { t: 'pass', rank: rare[rng.int(rare.length)]! };
  },
};
