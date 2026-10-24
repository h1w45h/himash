import { describe, expect, it } from 'vitest';
import { CATALOG } from './index';

describe('каталог игр', () => {
  it('содержит обязательный минимум игр', () => {
    const required = ['chess','checkers','backgammon','go','durak','poker','preferans','uno','svintus','monopoly','catan','carcassonne','ticket-to-ride','azul','munchkin','mafia','bunker','codenames','alias','dixit','imaginarium'];
    expect(CATALOG.map((g) => g.slug)).toEqual(expect.arrayContaining(required));
  });
  it('slug уникальны, диапазоны игроков корректны, правила не пустые', () => {
    const slugs = CATALOG.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const g of CATALOG) {
      expect(g.minPlayers).toBeGreaterThanOrEqual(2);
      expect(g.minPlayers).toBeLessThanOrEqual(g.maxPlayers);
      expect(g.rulesMarkdown.length).toBeGreaterThan(100);
    }
  });
});
