import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/rng';
import { svintusGame as g, WORD, type SvintusAction, type SvintusState } from './index';

const act = (s: SvintusState, seat: number, a: SvintusAction) => {
  const v = g.validate(s, seat, a);
  if (!v.ok) throw new Error(`${v.error}: ${JSON.stringify(a)}`);
  return g.apply(s, seat, a);
};
const rig = (hands: number[][]): SvintusState => {
  const s = g.setup({ players: hands.length, seed: 'x' });
  s.hands = hands.map((h) => [...h].sort((a, b) => a - b));
  return s;
};

describe('раздача', () => {
  it('по 4 карты, каждого зверя ровно 4', () => {
    for (let n = 3; n <= 6; n++) {
      const s = g.setup({ players: n, seed: `s${n}` });
      expect(s.hands.every((h) => h.length === 4)).toBe(true);
      const all = s.hands.flat();
      for (let r = 0; r < n; r++) expect(all.filter((x) => x === r)).toHaveLength(4);
      expect(g.currentSeats(s)).toEqual(Array.from({ length: n }, (_, i) => i));
    }
  });
  it('view скрывает чужие руки', () => {
    const s = g.setup({ players: 3, seed: 'v' });
    expect(g.view(s, 1).hand).toEqual(s.hands[1]);
    expect(JSON.stringify(g.view(s, 1))).not.toContain(JSON.stringify(s.hands[0]));
  });
});

describe('передача карт', () => {
  it('одновременный выбор, затем сдвиг влево', () => {
    let s = rig([[0, 0, 1, 2], [1, 1, 2, 0], [2, 2, 0, 1]]);
    s = act(s, 0, { t: 'pass', rank: 2 });
    expect(g.currentSeats(s)).toEqual([1, 2]);
    expect(g.validate(s, 0, { t: 'pass', rank: 0 }).ok).toBe(false); // уже выбрал
    s = act(s, 1, { t: 'pass', rank: 2 });
    s = act(s, 2, { t: 'pass', rank: 0 });
    // 0 отдал 2 → игроку 1; 1 отдал 2 → игроку 2; 2 отдал 0 → игроку 0
    expect(s.hands[0]).toEqual([0, 0, 0, 1]);
    expect(s.hands[1]).toEqual([0, 1, 1, 2].sort());
    expect(s.hands[2]).toEqual([1, 2, 2, 2]);
    expect(g.currentSeats(s)).toEqual([0, 1, 2]);
  });
  it('нельзя отдать карту, которой нет', () => {
    const s = rig([[0, 0, 1, 2], [1, 1, 2, 0], [2, 2, 0, 1]]);
    expect(g.validate(s, 0, { t: 'pass', rank: 5 }).ok).toBe(false);
  });
});

describe('пятачок', () => {
  it('без четвёрки нажать нельзя', () => {
    const s = rig([[0, 0, 1, 2], [1, 1, 2, 0], [2, 2, 0, 1]]);
    expect(g.validate(s, 0, { t: 'snout' }).ok).toBe(false);
  });
  it('гонка: опоздавший получает букву, раунд начинается заново', () => {
    let s = rig([[0, 0, 0, 0], [1, 1, 2, 0], [2, 2, 1, 1]]);
    s = act(s, 0, { t: 'snout' });
    expect(s.phase).toBe('race');
    expect(g.currentSeats(s)).toEqual([1, 2]);
    s = act(s, 2, { t: 'snout' });
    s = act(s, 1, { t: 'snout' }); // последним — игрок 1
    expect(s.letters).toEqual([0, 1, 0]);
    expect(s.phase).toBe('pass');
    expect(s.round).toBe(2);
    expect(s.hands.every((h) => h.length === 4)).toBe(true);
  });
  it('в гонке передавать карты нельзя', () => {
    let s = rig([[0, 0, 0, 0], [1, 1, 2, 0], [2, 2, 1, 1]]);
    s = act(s, 0, { t: 'snout' });
    expect(g.validate(s, 1, { t: 'pass', rank: 1 }).ok).toBe(false);
  });
  it('семь букв — вылет; последний оставшийся побеждает', () => {
    let s = rig([[0, 0, 0, 0], [1, 1, 2, 0], [2, 2, 1, 1]]);
    s.letters = [0, WORD.length - 1, WORD.length - 1];
    s = act(s, 0, { t: 'snout' });
    s = act(s, 2, { t: 'snout' });
    s = act(s, 1, { t: 'snout' }); // 1 вылетает
    expect(s.out).toEqual([false, true, false]);
    expect(s.finished).toBe(false);
    expect(g.currentSeats(s)).toEqual([0, 2]);
    // следующий раунд вдвоём: ранги 0 и 1 → раздача 2 зверей
    expect(s.hands[0]!.concat(s.hands[2]!).every((r) => r < 2)).toBe(true);
    // добиваем игрока 2
    s.hands[0] = [0, 0, 0, 0];
    s.letters[2] = WORD.length - 1;
    s = act(s, 0, { t: 'snout' });
    s = act(s, 2, { t: 'snout' });
    expect(s.finished).toBe(true);
    expect(g.outcome(s)).toMatchObject({ winners: [0], ranking: [0, 2, 1] });
  });
});

describe('игра целиком', () => {
  it('боты и таймауты доводят партию до конца', () => {
    for (let n = 0; n < 30; n++) {
      const rng = createRng(`sv${n}`);
      let s = g.setup({ players: 3 + (n % 4), seed: `g${n}` });
      let steps = 0;
      while (!g.outcome(s)) {
        const seats = g.currentSeats(s);
        expect(seats.length).toBeGreaterThan(0);
        const seat = seats[rng.int(seats.length)]!;
        const a = g.chooseBotAction!(s, seat, { level: n % 2 ? 'EASY' : 'MEDIUM', rngSeed: `${n}:${steps}` });
        const v = g.validate(s, seat, a);
        if (!v.ok) throw new Error(`${v.error} ${JSON.stringify(a)}`);
        s = g.apply(s, seat, a);
        if (++steps > 200000) throw new Error('не заканчивается');
      }
    }
  }, 120_000);
});
