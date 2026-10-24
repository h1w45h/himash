import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/rng';
import { bunkerGame as g, CATEGORIES, type BunkerAction, type BunkerState } from './index';

const act = (s: BunkerState, seat: number, a: BunkerAction) => {
  const v = g.validate(s, seat, a);
  if (!v.ok) throw new Error(`${v.error}: ${JSON.stringify(a)} (место ${seat})`);
  return g.apply(s, seat, a);
};
const alive = (s: BunkerState) => s.alive.map((a, i) => (a ? i : -1)).filter((i) => i >= 0);
/** Проводит раунд до голосования: все открывают первую доступную карту и жмут «Готов». */
function toVote(s: BunkerState): BunkerState {
  for (const i of alive(s)) s = act(s, i, g.legalActions(s, i)[0]!);
  for (const i of alive(s)) s = act(s, i, { t: 'ready' });
  return s;
}

describe('подготовка', () => {
  it('карты у всех игроков полные, вместимость — половина', () => {
    for (const n of [4, 5, 8, 12]) {
      const s = g.setup({ players: n, seed: `b${n}` });
      expect(s.capacity).toBe(Math.ceil(n / 2));
      for (const c of s.cards) for (const k of [...CATEGORIES, 'person']) expect(c[k]).toBeTruthy();
      // профессии не повторяются
      expect(new Set(s.cards.map((c) => c.profession)).size).toBe(n);
    }
  });
  it('чужие закрытые карты не видны', () => {
    const s = g.setup({ players: 5, seed: 'v' });
    const v = g.view(s, 0);
    expect(v.cards[0]!.profession).toBe(s.cards[0]!.profession);
    expect(v.cards[1]!.profession).toBeNull();
    expect(JSON.stringify(v)).not.toContain(s.cards[1]!.hobby);
  });
});

describe('раунд', () => {
  it('в первом раунде открывается профессия; затем — любая карта', () => {
    let s = g.setup({ players: 5, seed: 'r' });
    expect(g.legalActions(s, 0)).toEqual([{ t: 'reveal', cat: 'profession' }]);
    expect(g.validate(s, 0, { t: 'reveal', cat: 'hobby' }).ok).toBe(false);
    s = toVote(s);
    expect(s.phase).toBe('vote');
    expect(g.view(s, 3).cards[0]!.profession).toBe(s.cards[0]!.profession); // открытое видно всем
    for (const i of alive(s)) s = act(s, i, { t: 'vote', target: (i + 1) % 5 === i ? 0 : (i === 0 ? 1 : 0) });
  });
  it('единственный лидер голосования изгоняется, его карты раскрываются', () => {
    let s = toVote(g.setup({ players: 6, seed: 'x' }));
    for (const i of alive(s)) s = act(s, i, { t: 'vote', target: i === 2 ? 3 : 2 });
    expect(s.alive[2]).toBe(false);
    expect(s.exiledOrder).toEqual([2]);
    expect(s.round).toBe(2);
    expect(g.view(s, 0).cards[2]!.hobby).toBe(s.cards[2]!.hobby);
    expect(g.legalActions(s, 0).length).toBeGreaterThan(1); // свободный выбор карты
  });
  it('ничья → переголосование между лидерами → жребий при повторной ничьей', () => {
    let s = toVote(g.setup({ players: 6, seed: 'tie' }));
    // за 3 голосуют 0, 1, 4; за 4 — 2, 3, 5 → ничья 3/3
    const first = [3, 3, 4, 4, 3, 4];
    for (let i = 0; i < 6; i++) s = act(s, i, { t: 'vote', target: first[i]! });
    expect(s.phase).toBe('revote');
    expect(s.candidates.length).toBeGreaterThanOrEqual(2);
    const [a, b] = s.candidates as [number, number];
    expect([a, b].sort()).toEqual([3, 4]);
    expect(g.validate(s, 0, { t: 'vote', target: 5 }).ok).toBe(false); // только кандидаты
    // раскладываем голоса поровну между a и b
    let k = 0;
    for (const i of alive(s)) {
      const target = i === a ? b : i === b ? a : k++ % 2 ? a : b;
      s = act(s, i, { t: 'vote', target });
    }
    const out = s.exiledOrder[0]!;
    expect([a, b]).toContain(out);
    expect(s.alive[out]).toBe(false);
  });
  it('игра заканчивается, когда остаётся вместимость бункера', () => {
    let s = g.setup({ players: 4, seed: 'end' });
    for (let round = 0; round < 2; round++) {
      s = toVote(s);
      const a = alive(s);
      const target = a[a.length - 1]!;
      for (const i of a) s = act(s, i, { t: 'vote', target: i === target ? a[0]! : target });
    }
    expect(s.finished).toBe(true);
    expect(alive(s)).toHaveLength(2);
    const o = g.outcome(s)!;
    expect(o.winners).toEqual(alive(s));
    expect(o.ranking).toHaveLength(4);
  });
  it('чат: только живым', () => {
    let s = toVote(g.setup({ players: 6, seed: 'c' }));
    for (const i of alive(s)) s = act(s, i, { t: 'vote', target: i === 2 ? 3 : 2 });
    expect(g.chatAllowed!(s, 2)).toBe(false);
    expect(g.chatAllowed!(s, 3)).toBe(true);
  });
});

describe('случайные партии', () => {
  it('всегда завершаются', () => {
    for (let n = 0; n < 50; n++) {
      const rng = createRng(`bk${n}`);
      let s = g.setup({ players: 4 + (n % 9), seed: `g${n}` });
      let steps = 0;
      while (!g.outcome(s)) {
        const seats = g.currentSeats(s);
        expect(seats.length).toBeGreaterThan(0);
        const seat = seats[rng.int(seats.length)]!;
        const legal = g.legalActions(s, seat);
        expect(legal.length).toBeGreaterThan(0);
        s = g.apply(s, seat, legal[rng.int(legal.length)]!);
        if (++steps > 5000) throw new Error('не заканчивается');
      }
    }
  });
});
