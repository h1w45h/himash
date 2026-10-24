import { createRng } from '../../core/rng';
import { fail, ok, type GameDefinition, type Outcome, type Seat } from '../../core/types';
import { WORDS_RU } from '../../words/ru';

export type Team = 0 | 1; // 0 — красные, 1 — синие
export type Card = 'red' | 'blue' | 'neutral' | 'assassin';
export const TEAM_NAMES = ['Красные', 'Синие'] as const;

/**
 * Кодовые имена. Места чётные — красные, нечётные — синие; первый игрок каждой команды — капитан (видит ключ),
 * остальные — оперативники. Капитан даёт подсказку «слово + число», оперативники называют слова на столе.
 * Пока тот, кто начинает, имеет 9 слов, а второй — 8; 7 нейтральных и один убийца.
 */
export interface CodenamesState {
  players: number;
  words: string[];
  /** Ключ: чьё слово на каждой позиции. Знают только капитаны. */
  key: Card[];
  revealed: boolean[];
  turn: Team;
  phase: 'clue' | 'guess';
  clue: { word: string; number: number } | null;
  guesses: number;
  log: string[];
  winner: Team | null;
  reason: 'all' | 'assassin' | null;
  finished: boolean;
}

export type CodenamesAction =
  | { t: 'clue'; word: string; number: number }
  | { t: 'guess'; idx: number }
  | { t: 'endTurn' }
  /** Служебное: капитан не успел дать подсказку — ход переходит. */
  | { t: 'skip' };

export interface CodenamesView {
  players: number;
  words: string[];
  /** Для капитанов — полный ключ, для остальных — только открытые карты (null — скрыто). */
  key: (Card | null)[];
  revealed: boolean[];
  turn: Team;
  phase: 'clue' | 'guess';
  clue: { word: string; number: number } | null;
  guesses: number;
  remaining: [number, number];
  myTeam: Team;
  spymaster: boolean;
  log: string[];
  winner: Team | null;
  reason: 'all' | 'assassin' | null;
  finished: boolean;
}

const teamOf = (seat: Seat): Team => (seat % 2) as Team;
export const spymasterOf = (team: Team): Seat => team;
const isSpymaster = (seat: Seat) => seat < 2;
const cardOf = (t: Team): Card => (t === 0 ? 'red' : 'blue');
const clone = (s: CodenamesState): CodenamesState => JSON.parse(JSON.stringify(s)) as CodenamesState;
const log = (s: CodenamesState, t: string) => {
  s.log.push(t);
  if (s.log.length > 30) s.log.shift();
};
const norm = (w: string) => w.trim().toLowerCase().replace(/ё/g, 'е');

export const remaining = (s: CodenamesState, team: Team): number => s.key.filter((c, i) => c === cardOf(team) && !s.revealed[i]).length;

const operatives = (s: CodenamesState, team: Team) => Array.from({ length: s.players }, (_, i) => i).filter((i) => teamOf(i) === team && !isSpymaster(i));

function switchTurn(s: CodenamesState) {
  s.turn = (1 - s.turn) as Team;
  s.phase = 'clue';
  s.clue = null;
  s.guesses = 0;
}

export const codenamesGame: GameDefinition<CodenamesState, CodenamesAction, CodenamesView> = {
  slug: 'codenames',
  minPlayers: 4,
  maxPlayers: 10,

  setup: ({ players, seed }) => {
    const rng = createRng(seed);
    const words = rng.shuffle(WORDS_RU).slice(0, 25);
    const first = rng.int(2) as Team;
    const key: Card[] = rng.shuffle<Card>([
      ...Array<Card>(9).fill(cardOf(first)), ...Array<Card>(8).fill(cardOf((1 - first) as Team)), ...Array<Card>(7).fill('neutral'), 'assassin',
    ]);
    return {
      players, words, key, revealed: Array(25).fill(false), turn: first, phase: 'clue', clue: null, guesses: 0,
      log: [`Начинают ${TEAM_NAMES[first]!.toLowerCase()} (у них 9 слов).`], winner: null, reason: null, finished: false,
    };
  },

  currentSeats: (s) => (s.finished ? [] : s.phase === 'clue' ? [spymasterOf(s.turn)] : operatives(s, s.turn)),

  legalActions: (s, seat) => {
    if (!codenamesGame.currentSeats(s).includes(seat)) return [];
    if (s.phase === 'clue') return [{ t: 'skip' }];
    const acts: CodenamesAction[] = s.words.map((_, idx) => idx).filter((i) => !s.revealed[i]).map((idx) => ({ t: 'guess', idx }));
    if (s.guesses > 0) acts.push({ t: 'endTurn' });
    return acts;
  },

  validate: (s, seat, a) => {
    if (s.finished) return fail('Партия завершена');
    if (!codenamesGame.currentSeats(s).includes(seat)) return fail(s.phase === 'clue' ? 'Сейчас подсказку даёт капитан' : 'Сейчас угадывает другая команда');
    const act = a as CodenamesAction | null;
    if (!act || typeof act !== 'object') return fail('Некорректное действие');
    if (act.t === 'skip') return ok(undefined);
    if (s.phase === 'clue') {
      if (act.t !== 'clue') return fail('Сначала нужна подсказка');
      const word = norm(String(act.word ?? ''));
      if (!/^[а-яa-z-]{2,24}$/.test(word)) return fail('Подсказка — одно слово (2–24 буквы)');
      if (!Number.isInteger(act.number) || act.number < 0 || act.number > 9) return fail('Число — от 0 до 9');
      // Нельзя называть слово со стола, а также слова, являющиеся частью друг друга (однокоренные формы).
      const clash = s.words.some((w, i) => {
        if (s.revealed[i]) return false;
        const n = norm(w);
        return n === word || (word.length >= 4 && n.length >= 4 && (n.includes(word) || word.includes(n)));
      });
      return clash ? fail('Нельзя называть слово со стола') : ok(undefined);
    }
    if (act.t === 'endTurn') return s.guesses > 0 ? ok(undefined) : fail('Нужно назвать хотя бы одно слово');
    if (act.t !== 'guess') return fail('Назовите слово на столе');
    if (!Number.isInteger(act.idx) || act.idx < 0 || act.idx >= 25) return fail('Нет такого слова');
    return s.revealed[act.idx] ? fail('Слово уже открыто') : ok(undefined);
  },

  apply: (prev, seat, a) => {
    const s = clone(prev);
    if (a.t === 'skip') {
      log(s, `${TEAM_NAMES[s.turn]} пропускают ход.`);
      switchTurn(s);
      return s;
    }
    if (a.t === 'clue') {
      s.clue = { word: norm(a.word), number: a.number };
      s.phase = 'guess';
      s.guesses = 0;
      log(s, `${TEAM_NAMES[s.turn]}: подсказка «${s.clue.word}» — ${a.number === 0 ? '∞' : a.number}.`);
      return s;
    }
    if (a.t === 'endTurn') {
      log(s, `${TEAM_NAMES[s.turn]} заканчивают ход.`);
      switchTurn(s);
      return s;
    }
    s.revealed[a.idx] = true;
    s.guesses++;
    const card = s.key[a.idx]!;
    log(s, `${TEAM_NAMES[s.turn]} открывают «${s.words[a.idx]}» — ${card === 'assassin' ? 'УБИЙЦА!' : card === 'neutral' ? 'нейтральное слово' : card === cardOf(s.turn) ? 'свой агент' : 'агент соперника'}.`);
    if (card === 'assassin') {
      s.finished = true;
      s.reason = 'assassin';
      s.winner = (1 - s.turn) as Team;
      return s;
    }
    for (const t of [0, 1] as const) {
      if (remaining(s, t) === 0) {
        s.finished = true;
        s.reason = 'all';
        s.winner = t;
        return s;
      }
    }
    const limit = s.clue!.number === 0 ? Infinity : s.clue!.number + 1;
    if (card !== cardOf(s.turn) || s.guesses >= limit) switchTurn(s);
    return s;
  },

  chatAllowed: (s, seat) => !s.finished ? !isSpymaster(seat) : true, // капитаны молчат

  outcome: (s): Outcome | null => {
    if (!s.finished || s.winner === null) return null;
    const winners = Array.from({ length: s.players }, (_, i) => i).filter((i) => teamOf(i) === s.winner);
    const losers = Array.from({ length: s.players }, (_, i) => i).filter((i) => teamOf(i) !== s.winner);
    return { winners, ranking: [...winners, ...losers], reason: s.reason === 'assassin' ? 'assassin' : 'agents' };
  },

  view: (s, seat) => {
    const team = seat === null ? 0 : teamOf(seat);
    const spy = seat !== null && isSpymaster(seat);
    return {
      players: s.players, words: s.words, key: s.key.map((c, i) => (spy || s.finished || s.revealed[i] ? c : null)), revealed: s.revealed,
      turn: s.turn, phase: s.phase, clue: s.clue, guesses: s.guesses, remaining: [remaining(s, 0), remaining(s, 1)], myTeam: team,
      spymaster: spy, log: s.log, winner: s.winner, reason: s.reason, finished: s.finished,
    };
  },

  timeoutAction: (s) => (s.phase === 'clue' ? { t: 'skip' } : s.guesses > 0 ? { t: 'endTurn' } : { t: 'skip' }),
};
