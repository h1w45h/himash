import { createRng } from '../../core/rng';
import { fail, ok, type GameDefinition, type Outcome, type Seat } from '../../core/types';

export type Role = 'mafia' | 'sheriff' | 'doctor' | 'civilian';
export type Phase = 'night' | 'discuss' | 'vote';

export const ROLE_NAMES: Record<Role, string> = { mafia: 'Мафия', sheriff: 'Комиссар', doctor: 'Доктор', civilian: 'Мирный житель' };

/**
 * Мафия. Роли: мафия (≈ ⅓ игроков), комиссар, доктор (от 7 игроков), остальные — мирные.
 * Ночь: мафия выбирает жертву, комиссар проверяет игрока, доктор лечит. День: обсуждение (чат) и голосование.
 * Мирные побеждают, когда мафии не осталось; мафия — когда её не меньше, чем остальных.
 */
export interface MafiaState {
  players: number;
  roles: Role[];
  alive: boolean[];
  phase: Phase;
  day: number;
  /** Ночные выборы: -1 — пропуск. */
  mafiaVotes: Record<number, number>;
  checked: number | null | undefined;
  healed: number | null | undefined;
  /** Кого лечил доктор прошлой ночью (повторно подряд нельзя). */
  lastHeal: number;
  /** Результаты проверок комиссара: seat → true, если мафия. */
  checks: Record<number, boolean>;
  ready: boolean[];
  votes: Record<number, number>;
  /** Публичный журнал событий. */
  log: string[];
  rng: number;
  finished: boolean;
  winner: 'mafia' | 'town' | null;
}

export type MafiaAction =
  | { t: 'kill'; target: number }
  | { t: 'check'; target: number }
  | { t: 'heal'; target: number }
  | { t: 'ready' }
  | { t: 'vote'; target: number };

export interface MafiaView {
  players: number;
  me: Role | null;
  alive: boolean[];
  phase: Phase;
  day: number;
  /** Товарищи по мафии (только для мафии) или все роли после конца игры. */
  roles: (Role | null)[];
  /** Для мафии: чьи голоса за кого этой ночью. */
  teamVotes: Record<number, number>;
  checks: Record<number, boolean>;
  lastHeal: number;
  acted: boolean[];
  log: string[];
  finished: boolean;
  winner: 'mafia' | 'town' | null;
}

const clone = (s: MafiaState): MafiaState => JSON.parse(JSON.stringify(s)) as MafiaState;
const name = (seat: Seat) => `Игрок ${seat + 1}`;
const log = (s: MafiaState, t: string) => {
  s.log.push(t);
  if (s.log.length > 40) s.log.shift();
};
const aliveSeats = (s: MafiaState) => s.roles.map((_, i) => i).filter((i) => s.alive[i]);
const aliveOf = (s: MafiaState, role: Role) => aliveSeats(s).filter((i) => s.roles[i] === role);

export function roleCounts(n: number): { mafia: number; sheriff: number; doctor: number } {
  return { mafia: Math.max(1, Math.floor(n / 3)), sheriff: 1, doctor: n >= 7 ? 1 : 0 };
}

function checkWin(s: MafiaState): boolean {
  const mafia = aliveOf(s, 'mafia').length;
  const rest = aliveSeats(s).length - mafia;
  if (mafia === 0) s.winner = 'town';
  else if (mafia >= rest) s.winner = 'mafia';
  else return false;
  s.finished = true;
  log(s, s.winner === 'town' ? 'Мафия разоблачена — побеждают мирные жители!' : 'Мафия захватила город — побеждает мафия!');
  return true;
}

function nightDone(s: MafiaState): boolean {
  const mafiaDone = aliveOf(s, 'mafia').every((m) => s.mafiaVotes[m] !== undefined);
  const sheriffDone = aliveOf(s, 'sheriff').length === 0 || s.checked !== undefined;
  const doctorDone = aliveOf(s, 'doctor').length === 0 || s.healed !== undefined;
  return mafiaDone && sheriffDone && doctorDone;
}

function resolveNight(s: MafiaState) {
  const rng = createRng(s.rng);
  // Жертва мафии — большинство голосов; при равенстве — случайный из лидеров; без голосов — никто.
  const tally = new Map<number, number>();
  for (const t of Object.values(s.mafiaVotes)) if (t >= 0) tally.set(t, (tally.get(t) ?? 0) + 1);
  let victim = -1;
  if (tally.size) {
    const max = Math.max(...tally.values());
    const leaders = [...tally.entries()].filter(([, c]) => c === max).map(([t]) => t).sort((a, b) => a - b);
    victim = leaders[rng.int(leaders.length)]!;
  }
  s.rng = rng.state;

  if (s.checked !== undefined && s.checked !== null && s.checked >= 0) {
    const sheriff = aliveOf(s, 'sheriff')[0];
    if (sheriff !== undefined) s.checks[s.checked] = s.roles[s.checked] === 'mafia';
  }
  const healed = s.healed ?? -1;
  s.lastHeal = healed;
  s.day++;
  if (victim >= 0 && victim !== healed) {
    s.alive[victim] = false;
    log(s, `Утро ${s.day}. Ночью убит ${name(victim)} (${ROLE_NAMES[s.roles[victim]!]}).`);
  } else {
    log(s, `Утро ${s.day}. ${victim >= 0 ? 'Доктор спас жертву — никто не погиб.' : 'Этой ночью никто не погиб.'}`);
  }
  s.mafiaVotes = {};
  s.checked = undefined;
  s.healed = undefined;
  if (checkWin(s)) return;
  s.phase = 'discuss';
  s.ready = Array(s.players).fill(false);
}

function resolveVote(s: MafiaState) {
  const tally = new Map<number, number>();
  for (const t of Object.values(s.votes)) if (t >= 0) tally.set(t, (tally.get(t) ?? 0) + 1);
  const summary = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([t, c]) => `${name(t)} — ${c}`).join(', ');
  log(s, `Голосование: ${summary || 'никто не проголосовал'}.`);
  const max = tally.size ? Math.max(...tally.values()) : 0;
  const leaders = [...tally.entries()].filter(([, c]) => c === max).map(([t]) => t);
  if (leaders.length === 1) {
    const out = leaders[0]!;
    s.alive[out] = false;
    log(s, `Город изгоняет ${name(out)} — это был(а) ${ROLE_NAMES[s.roles[out]!]}.`);
  } else {
    log(s, leaders.length > 1 ? 'Голоса разделились — никого не изгоняют.' : 'Никого не изгоняют.');
  }
  s.votes = {};
  if (checkWin(s)) return;
  s.phase = 'night';
}

export const mafiaGame: GameDefinition<MafiaState, MafiaAction, MafiaView> = {
  slug: 'mafia',
  minPlayers: 5,
  maxPlayers: 15,

  setup: ({ players, seed }) => {
    const rng = createRng(seed);
    const c = roleCounts(players);
    const roles: Role[] = [
      ...Array<Role>(c.mafia).fill('mafia'), ...Array<Role>(c.sheriff).fill('sheriff'), ...Array<Role>(c.doctor).fill('doctor'),
    ];
    while (roles.length < players) roles.push('civilian');
    return {
      players, roles: rng.shuffle(roles), alive: Array(players).fill(true), phase: 'night', day: 0, mafiaVotes: {}, checked: undefined,
      healed: undefined, lastHeal: -1, checks: {}, ready: Array(players).fill(false), votes: {}, log: ['Город засыпает. Просыпается мафия…'],
      rng: rng.state, finished: false, winner: null,
    };
  },

  currentSeats: (s) => {
    if (s.finished) return [];
    if (s.phase === 'night') {
      return [
        ...aliveOf(s, 'mafia').filter((m) => s.mafiaVotes[m] === undefined),
        ...(s.checked === undefined ? aliveOf(s, 'sheriff') : []),
        ...(s.healed === undefined ? aliveOf(s, 'doctor') : []),
      ];
    }
    if (s.phase === 'discuss') return aliveSeats(s).filter((i) => !s.ready[i]);
    return aliveSeats(s).filter((i) => s.votes[i] === undefined);
  },

  legalActions: (s, seat) => {
    if (!mafiaGame.currentSeats(s).includes(seat)) return [];
    const alive = aliveSeats(s);
    const role = s.roles[seat]!;
    if (s.phase === 'night') {
      if (role === 'mafia') return [...alive.filter((t) => s.roles[t] !== 'mafia').map((target): MafiaAction => ({ t: 'kill', target })), { t: 'kill', target: -1 }];
      if (role === 'sheriff') return [...alive.filter((t) => t !== seat && s.checks[t] === undefined).map((target): MafiaAction => ({ t: 'check', target })), { t: 'check', target: -1 }];
      if (role === 'doctor') return [...alive.filter((t) => t !== s.lastHeal).map((target): MafiaAction => ({ t: 'heal', target })), { t: 'heal', target: -1 }];
      return [];
    }
    if (s.phase === 'discuss') return [{ t: 'ready' }];
    return [...alive.filter((t) => t !== seat).map((target): MafiaAction => ({ t: 'vote', target })), { t: 'vote', target: -1 }];
  },

  validate: (s, seat, a) => {
    if (s.finished) return fail('Игра окончена');
    if (!mafiaGame.currentSeats(s).includes(seat)) return fail('Сейчас вы не действуете');
    const legal = mafiaGame.legalActions(s, seat);
    const act = a as MafiaAction | null;
    if (!act || !legal.some((x) => x.t === act.t && ('target' in x ? x.target === (act as { target?: number }).target : true))) {
      return fail('Это действие сейчас недоступно');
    }
    return ok(undefined);
  },

  apply: (prev, seat, a) => {
    const s = clone(prev);
    switch (a.t) {
      case 'kill': s.mafiaVotes[seat] = a.target; break;
      case 'check': s.checked = a.target; break;
      case 'heal': s.healed = a.target; break;
      case 'ready': s.ready[seat] = true; break;
      case 'vote': s.votes[seat] = a.target; break;
    }
    if (s.phase === 'night' && nightDone(s)) resolveNight(s);
    else if (s.phase === 'discuss' && aliveSeats(s).every((i) => s.ready[i])) {
      s.phase = 'vote';
      log(s, 'Начинается голосование.');
    } else if (s.phase === 'vote' && aliveSeats(s).every((i) => s.votes[i] !== undefined)) resolveVote(s);
    return s;
  },

  chatAllowed: (s, seat) => !s.finished ? s.alive[seat] === true && s.phase !== 'night' : true,

  outcome: (s): Outcome | null => {
    if (!s.finished || !s.winner) return null;
    const mafiaTeam = (i: number) => s.roles[i] === 'mafia';
    const winners = s.roles.map((_, i) => i).filter((i) => (s.winner === 'mafia') === mafiaTeam(i));
    const losers = s.roles.map((_, i) => i).filter((i) => !winners.includes(i));
    return { winners, ranking: [...winners, ...losers], reason: s.winner };
  },

  view: (s, seat) => {
    const me = seat === null ? null : s.roles[seat]!;
    const reveal = s.finished;
    const roles = s.roles.map((r, i) => (reveal || i === seat || (me === 'mafia' && r === 'mafia') ? r : null));
    return {
      players: s.players, me, alive: s.alive, phase: s.phase, day: s.day, roles,
      teamVotes: me === 'mafia' && s.phase === 'night' ? s.mafiaVotes : {},
      checks: me === 'sheriff' || reveal ? s.checks : {},
      lastHeal: me === 'doctor' ? s.lastHeal : -1,
      acted: s.roles.map((_, i) => (s.phase === 'discuss' ? s.ready[i]! : s.phase === 'vote' ? s.votes[i] !== undefined : false)),
      log: s.log, finished: s.finished, winner: s.winner,
    };
  },

  timeoutAction: (s, seat) => {
    if (s.phase === 'night') {
      const r = s.roles[seat];
      return r === 'mafia' ? { t: 'kill', target: -1 } : r === 'sheriff' ? { t: 'check', target: -1 } : { t: 'heal', target: -1 };
    }
    return s.phase === 'discuss' ? { t: 'ready' } : { t: 'vote', target: -1 };
  },
};
