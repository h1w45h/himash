import { describe, expect, it } from 'vitest';
import { formGroups, ratingWindow, type Ticket } from './matchmaking-logic';

const t = (userId: string, rating: number, joinedAt = 0): Ticket => ({ userId, rating, joinedAt });

describe('ratingWindow', () => {
  it('растёт от 100 до 400', () => {
    expect(ratingWindow(0)).toBe(100);
    expect(ratingWindow(15_000)).toBe(250);
    expect(ratingWindow(60_000)).toBe(400);
  });
});

describe('formGroups', () => {
  it('сводит близких по рейтингу', () => {
    const g = formGroups([t('a', 1200), t('b', 1250), t('c', 1900)], 2, 2, 0);
    expect(g).toHaveLength(1);
    expect(g[0]?.map((x) => x.userId)).toEqual(['a', 'b']);
  });
  it('далёких не сводит сразу, но сводит после ожидания', () => {
    const tickets = [t('a', 1200), t('b', 1500)];
    expect(formGroups(tickets, 2, 2, 0)).toHaveLength(0);
    expect(formGroups(tickets, 2, 2, 30_000)).toHaveLength(1);
  });
  it('неполную группу собирает только после ожидания', () => {
    const tickets = [t('a', 1200), t('b', 1210), t('c', 1220)];
    expect(formGroups(tickets, 2, 4, 1_000)).toHaveLength(0);
    const g = formGroups(tickets, 2, 4, 20_000);
    expect(g).toHaveLength(1);
    expect(g[0]).toHaveLength(3);
  });
  it('не использует игрока дважды', () => {
    const g = formGroups([t('a', 1200), t('b', 1200), t('c', 1200), t('d', 1200), t('e', 1200)], 2, 2, 0);
    expect(g).toHaveLength(2);
    expect(new Set(g.flat().map((x) => x.userId)).size).toBe(4);
  });
});
