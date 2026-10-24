import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/rng';
import { mafiaGame as g, roleCounts, type MafiaAction, type MafiaState, type Role } from './index';

const act = (s: MafiaState, seat: number, a: MafiaAction) => {
  const v = g.validate(s, seat, a);
  if (!v.ok) throw new Error(`${v.error}: ${JSON.stringify(a)} (место ${seat})`);
  return g.apply(s, seat, a);
};
/** Игра с заданными ролями. */
function game(roles: Role[]): MafiaState {
  const s = g.setup({ players: roles.length, seed: 'm' });
  s.roles = roles;
  return s;
}
const seatOf = (s: MafiaState, role: Role) => s.roles.indexOf(role);

describe('роли', () => {
  it('распределение по числу игроков', () => {
    expect(roleCounts(5)).toEqual({ mafia: 1, sheriff: 1, doctor: 0 });
    expect(roleCounts(7)).toEqual({ mafia: 2, sheriff: 1, doctor: 1 });
    expect(roleCounts(12)).toEqual({ mafia: 4, sheriff: 1, doctor: 1 });
    for (let n = 5; n <= 15; n++) {
      const s = g.setup({ players: n, seed: `r${n}` });
      const c = roleCounts(n);
      expect(s.roles.filter((r) => r === 'mafia')).toHaveLength(c.mafia);
      expect(s.roles.filter((r) => r === 'sheriff')).toHaveLength(1);
      expect(s.roles.filter((r) => r === 'doctor')).toHaveLength(c.doctor);
      expect(s.roles).toHaveLength(n);
    }
  });
  it('роли скрыты; мафия видит своих; в конце всё открывается', () => {
    const s = game(['mafia', 'mafia', 'sheriff', 'civilian', 'civilian', 'civilian', 'doctor']);
    expect(g.view(s, 3).roles).toEqual([null, null, null, 'civilian', null, null, null]);
    expect(g.view(s, 0).roles).toEqual(['mafia', 'mafia', null, null, null, null, null]);
    expect(g.view(s, 2).roles.filter(Boolean)).toEqual(['sheriff']);
    expect(g.view({ ...s, finished: true, winner: 'town' }, 3).roles).toEqual(s.roles);
  });
});

describe('ночь', () => {
  const roles: Role[] = ['mafia', 'sheriff', 'doctor', 'civilian', 'civilian'];
  it('ночью действуют только мафия, комиссар и доктор', () => {
    const s = game(roles);
    expect(g.currentSeats(s)).toEqual([0, 1, 2]);
    expect(g.legalActions(s, 3)).toEqual([]);
    expect(g.validate(s, 0, { t: 'kill', target: 0 }).ok).toBe(false); // мафия не убивает своих
  });
  it('убийство без лечения', () => {
    let s = game(roles);
    s = act(s, 0, { t: 'kill', target: 3 });
    s = act(s, 1, { t: 'check', target: 0 });
    s = act(s, 2, { t: 'heal', target: 4 });
    expect(s.alive[3]).toBe(false);
    expect(s.phase).toBe('discuss');
    expect(s.checks).toEqual({ 0: true });
    expect(s.log.at(-1)).toContain('убит Игрок 4');
  });
  it('доктор спасает жертву; повторно подряд лечить того же нельзя', () => {
    let s = game(roles);
    s = act(s, 0, { t: 'kill', target: 3 });
    s = act(s, 1, { t: 'check', target: 3 });
    s = act(s, 2, { t: 'heal', target: 3 });
    expect(s.alive[3]).toBe(true);
    expect(s.log.at(-1)).toContain('спас');
    // следующая ночь
    s = { ...s, phase: 'night' };
    expect(g.validate(s, 2, { t: 'heal', target: 3 }).ok).toBe(false);
    expect(g.validate(s, 2, { t: 'heal', target: 4 }).ok).toBe(true);
  });
  it('мафия видит голоса товарищей, остальные — нет', () => {
    const s0 = game(['mafia', 'mafia', 'sheriff', 'doctor', 'civilian', 'civilian', 'civilian']);
    const s = act(s0, 0, { t: 'kill', target: 4 });
    expect(g.view(s, 1).teamVotes).toEqual({ 0: 4 });
    expect(g.view(s, 4).teamVotes).toEqual({});
  });
  it('таймаут: пропуск действий — никто не погибает', () => {
    let s = game(roles);
    for (const seat of [...g.currentSeats(s)]) s = g.apply(s, seat, g.timeoutAction!(s, seat)!);
    expect(s.alive.every(Boolean)).toBe(true);
    expect(s.phase).toBe('discuss');
  });
});

describe('день', () => {
  const day = () => {
    let s = game(['mafia', 'sheriff', 'doctor', 'civilian', 'civilian', 'civilian', 'civilian']);
    s = act(s, 0, { t: 'kill', target: -1 });
    s = act(s, 1, { t: 'check', target: -1 });
    s = act(s, 2, { t: 'heal', target: -1 });
    return s;
  };
  it('обсуждение → голосование → изгнание', () => {
    let s = day();
    expect(s.phase).toBe('discuss');
    for (let i = 0; i < 7; i++) s = act(s, i, { t: 'ready' });
    expect(s.phase).toBe('vote');
    expect(g.validate(s, 3, { t: 'vote', target: 3 }).ok).toBe(false); // за себя нельзя
    for (let i = 0; i < 7; i++) s = act(s, i, { t: 'vote', target: i === 0 ? 3 : 0 });
    expect(s.alive[0]).toBe(false);
    expect(s.finished).toBe(true);
    expect(s.winner).toBe('town');
    expect(g.outcome(s)).toMatchObject({ winners: [1, 2, 3, 4, 5, 6], reason: 'town' });
  });
  it('ничья в голосовании — никого не изгоняют', () => {
    let s = day();
    for (let i = 0; i < 7; i++) s = act(s, i, { t: 'ready' });
    const targets = [1, 0, 0, 1, 2, 2, 2]; // 0:2 голоса, 1:2, 2:3 → лидер один; сделаем ровно 2-2
    const tied = [1, 0, 1, 0, 2, 2, 3];
    void targets;
    for (let i = 0; i < 7; i++) s = act(s, i, { t: 'vote', target: tied[i]! === i ? -1 : tied[i]! });
    expect(s.alive.every(Boolean)).toBe(true);
    expect(s.phase).toBe('night');
  });
  it('воздержавшиеся не влияют', () => {
    let s = day();
    for (let i = 0; i < 7; i++) s = act(s, i, { t: 'ready' });
    for (let i = 0; i < 7; i++) s = act(s, i, { t: 'vote', target: -1 });
    expect(s.alive.every(Boolean)).toBe(true);
  });
  it('чат: днём живым можно, ночью и мёртвым нельзя', () => {
    let s = day();
    expect(g.chatAllowed!(s, 3)).toBe(true);
    s = { ...s, alive: s.alive.map((a, i) => (i === 3 ? false : a)) };
    expect(g.chatAllowed!(s, 3)).toBe(false);
    expect(g.chatAllowed!({ ...s, phase: 'night' }, 4)).toBe(false);
  });
});

describe('победа мафии', () => {
  it('мафия не меньше остальных', () => {
    let s = game(['mafia', 'civilian', 'civilian']);
    s.players = 3;
    s = act(s, 0, { t: 'kill', target: 1 });
    expect(s.finished).toBe(true);
    expect(s.winner).toBe('mafia');
    expect(g.outcome(s)).toMatchObject({ winners: [0], reason: 'mafia' });
  });
});

describe('случайные партии', () => {
  it('всегда завершаются', () => {
    for (let n = 0; n < 60; n++) {
      const rng = createRng(`mf${n}`);
      let s = g.setup({ players: 5 + (n % 11), seed: `g${n}` });
      let steps = 0;
      while (!g.outcome(s)) {
        const seats = g.currentSeats(s);
        expect(seats.length).toBeGreaterThan(0);
        const seat = seats[rng.int(seats.length)]!;
        const legal = g.legalActions(s, seat);
        expect(legal.length).toBeGreaterThan(0);
        s = g.apply(s, seat, legal[rng.int(legal.length)]!);
        if (++steps > 20000) throw new Error('не заканчивается');
      }
    }
  });
});
