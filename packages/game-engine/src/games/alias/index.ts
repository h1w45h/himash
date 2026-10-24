import { createRng } from '../../core/rng';
import { fail, ok, type GameDefinition, type Outcome, type Seat } from '../../core/types';
import { WORDS_RU } from '../../words/ru';

export const TARGET = 30;
export const TEAM_NAMES = ['Красные', 'Синие'] as const;

/**
 * Элиас. Две команды (чётные места — красные, нечётные — синие). Игрок команды объясняет загаданные слова
 * своим (в чате или голосом), пока идёт время раунда; нажимает «Угадано» или «Пропуск». +1 за угаданное, −1 за пропуск.
 * До набора {TARGET} очков; игра заканчивается после равного числа раундов у обеих команд.
 */
export interface AliasState {
  players: number;
  deck: string[];
  word: string | null;
  turn: 0 | 1;
  /** Сколько раундов уже сыграла каждая команда. */
  played: [number, number];
  phase: 'ready' | 'play';
  scores: [number, number];
  /** Слова текущего раунда: слово и результат. */
  round: { word: string; ok: boolean }[];
  log: string[];
  rng: number;
  winner: 0 | 1 | null;
  finished: boolean;
}

export type AliasAction = { t: 'start' } | { t: 'ok' } | { t: 'skip' } | { t: 'endRound' };

export interface AliasView {
  players: number;
  turn: 0 | 1;
  explainer: Seat;
  phase: 'ready' | 'play';
  /** Слово видит только объясняющий. */
  word: string | null;
  scores: [number, number];
  round: { word: string; ok: boolean }[];
  target: number;
  log: string[];
  winner: 0 | 1 | null;
  finished: boolean;
}

const clone = (s: AliasState): AliasState => JSON.parse(JSON.stringify(s)) as AliasState;
const norm = (w: string) => w.trim().toLowerCase().replace(/ё/g, 'е');
const members = (s: AliasState, team: 0 | 1) => Array.from({ length: s.players }, (_, i) => i).filter((i) => i % 2 === team);
export const explainerOf = (s: AliasState): Seat => {
  const m = members(s, s.turn);
  return m[s.played[s.turn] % m.length]!;
};
const log = (s: AliasState, t: string) => {
  s.log.push(t);
  if (s.log.length > 20) s.log.shift();
};

function nextWord(s: AliasState) {
  if (s.deck.length === 0) {
    const rng = createRng(s.rng);
    s.deck = rng.shuffle(WORDS_RU);
    s.rng = rng.state;
  }
  s.word = s.deck.pop() as string;
}

function endRound(s: AliasState) {
  if (s.word && s.round.length === 0) s.word = null;
  s.played[s.turn]++;
  const gain = s.round.reduce((n, r) => n + (r.ok ? 1 : -1), 0);
  s.scores[s.turn] = Math.max(0, s.scores[s.turn] + gain);
  log(s, `${TEAM_NAMES[s.turn]}: раунд окончен, ${gain >= 0 ? '+' : ''}${gain} (всего ${s.scores[s.turn]}).`);
  s.word = null;
  s.round = [];
  // Игра заканчивается, когда команды сыграли поровну и кто-то набрал цель с перевесом.
  if (s.played[0] === s.played[1] && Math.max(...s.scores) >= TARGET && s.scores[0] !== s.scores[1]) {
    s.finished = true;
    s.winner = s.scores[0] > s.scores[1] ? 0 : 1;
    log(s, `${TEAM_NAMES[s.winner]} побеждают!`);
    return;
  }
  s.turn = (1 - s.turn) as 0 | 1;
  s.phase = 'ready';
}

export const aliasGame: GameDefinition<AliasState, AliasAction, AliasView> = {
  slug: 'alias',
  minPlayers: 4,
  maxPlayers: 12,

  setup: ({ players, seed }) => {
    const rng = createRng(seed);
    return {
      players, deck: rng.shuffle(WORDS_RU), word: null, turn: 0, played: [0, 0], phase: 'ready', scores: [0, 0], round: [],
      log: ['Начинают красные.'], rng: rng.state, winner: null, finished: false,
    };
  },

  currentSeats: (s) => (s.finished ? [] : [explainerOf(s)]),

  legalActions: (s, seat) => {
    if (s.finished || seat !== explainerOf(s)) return [];
    return s.phase === 'ready' ? [{ t: 'start' }] : [{ t: 'ok' }, { t: 'skip' }, { t: 'endRound' }];
  },

  validate: (s, seat, a) => {
    if (s.finished) return fail('Игра окончена');
    if (seat !== explainerOf(s)) return fail('Сейчас объясняет другой игрок');
    const legal = aliasGame.legalActions(s, seat);
    return legal.some((x) => x.t === (a as AliasAction | null)?.t) ? ok(undefined) : fail('Это действие сейчас недоступно');
  },

  apply: (prev, _seat, a) => {
    const s = clone(prev);
    if (a.t === 'start') {
      s.phase = 'play';
      nextWord(s);
      return s;
    }
    if (a.t === 'endRound') {
      endRound(s);
      return s;
    }
    s.round.push({ word: s.word as string, ok: a.t === 'ok' });
    nextWord(s);
    return s;
  },

  // Таймер раунда идёт, пока слова сменяются: сбрасывается только при старте и конце раунда.
  keepDeadline: (prev, next) => prev.phase === 'play' && next.phase === 'play' && !next.finished && prev.turn === next.turn && prev.played[prev.turn] === next.played[next.turn],

  chatFilter: (s, seat, body) => {
    if (s.phase !== 'play' || !s.word || seat !== explainerOf(s)) return null;
    const w = norm(s.word);
    const stem = w.slice(0, Math.max(3, w.length - 2));
    return norm(body).includes(stem) ? 'Нельзя называть загаданное слово и однокоренные' : null;
  },

  outcome: (s): Outcome | null => {
    if (!s.finished || s.winner === null) return null;
    const winners = Array.from({ length: s.players }, (_, i) => i).filter((i) => i % 2 === s.winner);
    const losers = Array.from({ length: s.players }, (_, i) => i).filter((i) => i % 2 !== s.winner);
    return { winners, ranking: [...winners, ...losers], reason: 'points', scores: Object.fromEntries(Array.from({ length: s.players }, (_, i) => [i, s.scores[i % 2]!])) };
  },

  view: (s, seat) => ({
    players: s.players, turn: s.turn, explainer: explainerOf(s), phase: s.phase,
    word: seat !== null && seat === explainerOf(s) && s.phase === 'play' ? s.word : null,
    scores: s.scores, round: s.round, target: TARGET, log: s.log, winner: s.winner, finished: s.finished,
  }),

  timeoutAction: (s) => (s.phase === 'ready' ? { t: 'start' } : { t: 'endRound' }),
};
