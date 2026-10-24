import { describe, expect, it } from 'vitest';
import { CARDS, DOOR_DECK, TREASURE_DECK, cardOf, goldOf } from './cards';

describe('карты Манчкина', () => {
  it('колоды: двери и сокровища, достаточно карт каждого вида', () => {
    expect(DOOR_DECK.length).toBeGreaterThan(50);
    expect(TREASURE_DECK.length).toBeGreaterThan(45);
    const kinds = (deck: number[]) => new Set(deck.map((id) => cardOf(id).kind));
    expect([...kinds(DOOR_DECK)].sort()).toEqual(['class', 'curse', 'enhancer', 'monster', 'race']);
    expect([...kinds(TREASURE_DECK)].sort()).toEqual(['item', 'levelup', 'potion', 'trap']);
  });
  it('нет пересечения колод, у монстров положительные уровень и сокровища', () => {
    expect(DOOR_DECK.some((id) => TREASURE_DECK.includes(id))).toBe(false);
    for (const c of CARDS) if (c.kind === 'monster') {
      expect(c.level).toBeGreaterThan(0);
      expect(c.treasures).toBeGreaterThan(0);
    }
  });
  it('цены продаваемых карт кратны 100', () => {
    for (const id of TREASURE_DECK) expect(goldOf(id) % 100).toBe(0);
  });
});
