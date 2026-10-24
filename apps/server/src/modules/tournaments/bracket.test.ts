import { describe, expect, it } from 'vitest';
import { firstRound, nextOf, nextPow2, placementForLoser, seedOrder, splitPrize } from './bracket';

describe('сетка', () => {
  it('порядок сеяных', () => {
    expect(seedOrder(2)).toEqual([1, 2]);
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });
  it('первый и второй сеяный встречаются только в финале', () => {
    const slots = firstRound(8);
    const half = (i: number) => slots.findIndex((s) => s.a === i || s.b === i) < 2 ? 0 : 1;
    expect(half(0)).not.toBe(half(1));
  });
  it('проходы получают сильнейшие', () => {
    expect(firstRound(3)).toEqual([{ a: 0, b: null }, { a: 1, b: 2 }]);
    expect(firstRound(5).filter((s) => s.b === null || s.a === null)).toHaveLength(3);
    expect(firstRound(2)).toEqual([{ a: 0, b: 1 }]);
  });
  it('каждый игрок встречается в первом раунде ровно один раз', () => {
    for (let n = 2; n <= 33; n++) {
      const ids = firstRound(n).flatMap((s) => [s.a, s.b]).filter((x): x is number => x !== null);
      expect([...ids].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
    }
  });
  it('продвижение и места', () => {
    expect(nextOf(1, 5)).toEqual({ round: 2, position: 2, slot: 1 });
    expect(nextPow2(5)).toBe(8);
    expect(placementForLoser(8, 3)).toBe(2); // проиграл финал
    expect(placementForLoser(8, 2)).toBe(3); // полуфинал
    expect(placementForLoser(8, 1)).toBe(5);
  });
  it('призы делятся без потерь', () => {
    for (const pool of [0, 1, 100, 333, 1000, 12345]) {
      for (const semis of [0, 2]) {
        const p = splitPrize(pool, semis);
        expect(p.first + p.second + p.semi * semis).toBe(pool);
        expect(p.first).toBeGreaterThanOrEqual(p.second);
      }
    }
  });
});
