import { createRng } from '../../core/rng';
import { fail, ok, type GameDefinition, type Outcome, type Seat } from '../../core/types';

/**
 * Игры на ассоциации («Диксит» и «Имаджинариум»): общий движок с разными настройками колоды и цели.
 * Рассказчик выбирает карту и придумывает к ней ассоциацию, остальные подкладывают подходящие карты,
 * все карты перемешиваются, и игроки угадывают карту рассказчика.
 *
 * Очки: если карту рассказчика угадали все или никто — он получает 0, остальные по 2. Иначе рассказчик и угадавшие получают по 3.
 * Каждый, кроме рассказчика, получает ещё по 1 очку за каждый голос, поданный за его карту (не более 3).
 */
export interface AssocConfig {
  slug: string;
  minPlayers: number;
  maxPlayers: number;
  deckSize: number;
  handSize: number;
  target: number;
}

export interface AssocState {
  cfg: { deckSize: number; handSize: number; target: number };
  players: number;
  deck: number[];
  hands: number[][];
  scores: number[];
  round: number;
  storyteller: Seat;
  phase: 'clue' | 'submit' | 'vote';
  clue: string;
  storyCard: number | null;
  /** Карты, выложенные на стол: владелец и карта. После перемешивания порядок = номера для голосования. */
  table: { owner: Seat; card: number }[];
  votes: Record<number, number>;
  /** Итоги последнего раунда (открываются после голосования). */
  last: { clue: string; storyteller: Seat; storyCard: number; table: { owner: Seat; card: number; votes: Seat[] }[]; delta: number[] } | null;
  rng: number;
  finished: boolean;
}

export type AssocAction =
  | { t: 'clue'; card: number; text: string }
  | { t: 'submit'; card: number }
  | { t: 'vote'; pos: number };

export interface AssocView {
  players: number;
  hand: number[];
  scores: number[];
  round: number;
  storyteller: Seat;
  phase: AssocState['phase'];
  clue: string;
  /** Карты на столе: во время сдачи видны только мои, при голосовании — все без владельцев. */
  table: { card: number; mine: boolean }[];
  submitted: boolean[];
  voted: boolean[];
  perPlayer: number;
  target: number;
  deckLeft: number;
  last: AssocState['last'];
  finished: boolean;
}

const clone = (s: AssocState): AssocState => JSON.parse(JSON.stringify(s)) as AssocState;
const others = (s: AssocState) => Array.from({ length: s.players }, (_, i) => i).filter((i) => i !== s.storyteller);
/** Карт на игрока: втроём каждый кладёт по две. */
const perPlayer = (s: AssocState) => (s.players === 3 ? 2 : 1);
const submittedCount = (s: AssocState, seat: Seat) => s.table.filter((t) => t.owner === seat).length;

function refill(s: AssocState) {
  for (let i = 0; i < s.players; i++) while (s.hands[i]!.length < s.cfg.handSize && s.deck.length) s.hands[i]!.push(s.deck.pop() as number);
}

function score(s: AssocState) {
  const delta = Array(s.players).fill(0) as number[];
  const voters = others(s);
  const storyPos = s.table.findIndex((t) => t.owner === s.storyteller);
  const right = voters.filter((v) => s.votes[v] === storyPos);
  if (right.length === 0 || right.length === voters.length) {
    for (const v of voters) delta[v]! += 2;
  } else {
    delta[s.storyteller]! += 3;
    for (const v of right) delta[v]! += 3;
  }
  // +1 за голос за карту игрока, максимум 3 за раунд.
  const gained = new Map<Seat, number>();
  s.table.forEach((t, pos) => {
    if (t.owner === s.storyteller) return;
    const n = voters.filter((v) => s.votes[v] === pos).length;
    gained.set(t.owner, (gained.get(t.owner) ?? 0) + n);
  });
  for (const [owner, n] of gained) delta[owner]! += Math.min(3, n);
  s.scores = s.scores.map((x, i) => x + delta[i]!);
  s.last = {
    clue: s.clue, storyteller: s.storyteller, storyCard: s.storyCard as number,
    table: s.table.map((t, pos) => ({ ...t, votes: voters.filter((v) => s.votes[v] === pos) })), delta,
  };
}

export function createAssociationGame(cfg: AssocConfig): GameDefinition<AssocState, AssocAction, AssocView> {
  const game: GameDefinition<AssocState, AssocAction, AssocView> = {
    slug: cfg.slug,
    minPlayers: cfg.minPlayers,
    maxPlayers: cfg.maxPlayers,

    setup: ({ players, seed }) => {
      const rng = createRng(seed);
      const s: AssocState = {
        cfg: { deckSize: cfg.deckSize, handSize: cfg.handSize, target: cfg.target }, players,
        deck: rng.shuffle(Array.from({ length: cfg.deckSize }, (_, i) => i)), hands: Array.from({ length: players }, () => []),
        scores: Array(players).fill(0), round: 1, storyteller: 0, phase: 'clue', clue: '', storyCard: null, table: [], votes: {},
        last: null, rng: rng.state, finished: false,
      };
      refill(s);
      return s;
    },

    currentSeats: (s) => {
      if (s.finished) return [];
      if (s.phase === 'clue') return [s.storyteller];
      if (s.phase === 'submit') return others(s).filter((i) => submittedCount(s, i) < perPlayer(s));
      return others(s).filter((i) => s.votes[i] === undefined);
    },

    legalActions: (s, seat) => {
      if (!game.currentSeats(s).includes(seat)) return [];
      const hand = s.hands[seat]!;
      if (s.phase === 'clue') return hand.map((card): AssocAction => ({ t: 'clue', card, text: '' }));
      if (s.phase === 'submit') return hand.map((card): AssocAction => ({ t: 'submit', card }));
      return s.table.map((t, pos) => ({ owner: t.owner, pos })).filter((x) => x.owner !== seat).map((x): AssocAction => ({ t: 'vote', pos: x.pos }));
    },

    validate: (s, seat, a) => {
      if (s.finished) return fail('Игра окончена');
      if (!game.currentSeats(s).includes(seat)) return fail('Сейчас вы не действуете');
      const act = a as AssocAction | null;
      if (!act || typeof act !== 'object') return fail('Некорректное действие');
      if (s.phase === 'clue') {
        if (act.t !== 'clue') return fail('Сначала нужна ассоциация');
        if (!s.hands[seat]!.includes(act.card)) return fail('У вас нет такой карты');
        const text = String(act.text ?? '').trim();
        return text.length >= 1 && text.length <= 80 ? ok(undefined) : fail('Ассоциация — от 1 до 80 символов');
      }
      if (s.phase === 'submit') {
        if (act.t !== 'submit') return fail('Выберите карту к ассоциации');
        return s.hands[seat]!.includes(act.card) ? ok(undefined) : fail('У вас нет такой карты');
      }
      if (act.t !== 'vote') return fail('Проголосуйте за карту');
      const t = s.table[act.pos];
      if (!t) return fail('Нет такой карты');
      return t.owner === seat ? fail('За свою карту голосовать нельзя') : ok(undefined);
    },

    apply: (prev, seat, a) => {
      const s = clone(prev);
      if (a.t === 'clue') {
        s.clue = a.text.trim();
        s.storyCard = a.card;
        s.hands[seat] = s.hands[seat]!.filter((c) => c !== a.card);
        s.table = [{ owner: seat, card: a.card }];
        s.phase = 'submit';
        return s;
      }
      if (a.t === 'submit') {
        s.hands[seat] = s.hands[seat]!.filter((c) => c !== a.card);
        s.table.push({ owner: seat, card: a.card });
        if (others(s).every((i) => submittedCount(s, i) >= perPlayer(s))) {
          const rng = createRng(s.rng);
          s.table = rng.shuffle(s.table); // порядок на столе не выдаёт владельца
          s.rng = rng.state;
          s.phase = 'vote';
          s.votes = {};
        }
        return s;
      }
      s.votes[seat] = a.pos;
      if (!others(s).every((i) => s.votes[i] !== undefined)) return s;

      score(s);
      s.table = [];
      s.votes = {};
      refill(s);
      const lowDeck = s.hands.some((h) => h.length < s.cfg.handSize) || s.hands[s.storyteller]!.length === 0;
      if (Math.max(...s.scores) >= s.cfg.target || lowDeck) {
        s.finished = true;
        return s;
      }
      s.round++;
      s.storyteller = (s.storyteller + 1) % s.players;
      s.phase = 'clue';
      s.clue = '';
      s.storyCard = null;
      return s;
    },

    chatAllowed: (s) => s.finished, // во время раундов обсуждать карты нельзя

    outcome: (s): Outcome | null => {
      if (!s.finished) return null;
      const order = s.scores.map((sc, i) => [sc, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
      const best = order[0]![0];
      return {
        winners: order.filter(([sc]) => sc === best).map(([, i]) => i), ranking: order.map(([, i]) => i), reason: 'points',
        scores: Object.fromEntries(s.scores.map((sc, i) => [i, sc])),
      };
    },

    view: (s, seat) => ({
      players: s.players, hand: seat === null ? [] : s.hands[seat]!, scores: s.scores, round: s.round, storyteller: s.storyteller,
      phase: s.phase, clue: s.clue,
      table: s.phase === 'submit'
        ? s.table.filter((t) => t.owner === seat).map((t) => ({ card: t.card, mine: true }))
        : s.phase === 'vote' ? s.table.map((t) => ({ card: t.card, mine: t.owner === seat })) : [],
      submitted: Array.from({ length: s.players }, (_, i) => i === s.storyteller || submittedCount(s, i) >= perPlayer(s)),
      voted: Array.from({ length: s.players }, (_, i) => i === s.storyteller || s.votes[i] !== undefined),
      perPlayer: perPlayer(s), target: s.cfg.target, deckLeft: s.deck.length, last: s.last, finished: s.finished,
    }),

    timeoutAction: (s, seat) => {
      const hand = s.hands[seat]!;
      if (s.phase === 'clue') return { t: 'clue', card: hand[0]!, text: 'Без слов' };
      if (s.phase === 'submit') return { t: 'submit', card: hand[0]! };
      const pos = s.table.findIndex((t) => t.owner !== seat);
      return { t: 'vote', pos };
    },
  };
  return game;
}

export const dixitGame = createAssociationGame({ slug: 'dixit', minPlayers: 3, maxPlayers: 8, deckSize: 84, handSize: 6, target: 30 });
export const imaginariumGame = createAssociationGame({ slug: 'imaginarium', minPlayers: 3, maxPlayers: 6, deckSize: 98, handSize: 6, target: 39 });
