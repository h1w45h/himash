import { describe, expect, it } from 'vitest';
import { featuresOf, START_TYPE, TILE_TYPES, TOTAL_TILES } from './tiles';

describe('плитки Каркассона', () => {
  it('72 плитки, 24 вида, стартовая — город с дорогой', () => {
    expect(TOTAL_TILES).toBe(72);
    expect(TILE_TYPES).toHaveLength(24);
    expect(TILE_TYPES[START_TYPE]!.sides).toBe('crfr');
  });
  it('у плитки «прямая дорога» два поля и одна дорога, у перекрёстка четыре дороги и четыре поля', () => {
    const u = TILE_TYPES.find((t) => t.name === 'Прямая дорога')!;
    expect(u.features.filter((f) => f.kind === 'road')).toHaveLength(1);
    expect(u.features.filter((f) => f.kind === 'field')).toHaveLength(2);
    const x = TILE_TYPES.find((t) => t.name === 'Перекрёсток')!;
    expect(x.features.filter((f) => f.kind === 'road')).toHaveLength(4);
    expect(x.features.filter((f) => f.kind === 'field')).toHaveLength(4);
  });
  it('поле вокруг углового города примыкает к нему; два города напротив делят поля', () => {
    const t = TILE_TYPES.find((t) => t.name === 'Угловой город')!;
    const field = t.features.find((f) => f.kind === 'field')!;
    expect(field.cities).toEqual([0]);
    expect(t.features.filter((f) => f.kind === 'field')).toHaveLength(1);
    const h = TILE_TYPES.find((t) => t.name === 'Два города напротив')!;
    expect(h.features.filter((f) => f.kind === 'field')).toHaveLength(2);
  });
  it('поворот переносит стороны и слоты', () => {
    const idx = TILE_TYPES.findIndex((t) => t.name === 'Город-тупик');
    expect(featuresOf(idx, 1)[0]!.sides).toEqual([1]);
    expect(featuresOf(idx, 3)[0]!.sides).toEqual([3]);
  });
  it('все 12 слотов границы распределены между полями, дорогами и городами', () => {
    for (const t of TILE_TYPES) {
      const fieldSlots = t.features.filter((f) => f.kind === 'field').flatMap((f) => f.slots);
      expect(new Set(fieldSlots).size).toBe(fieldSlots.length);
      const expected = [...t.sides].reduce((a, c) => a + (c === 'f' ? 3 : c === 'r' ? 2 : 0), 0);
      expect(fieldSlots.length).toBe(expected);
    }
  });
});
