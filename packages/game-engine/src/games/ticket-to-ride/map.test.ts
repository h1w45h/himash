import { describe, expect, it } from 'vitest';
import { CITIES, ROUTES, TICKETS, distances } from './map';

describe('карта', () => {
  it('маршруты корректны: города, длины 1–6, цвета', () => {
    for (const r of ROUTES) {
      expect(r.a).not.toBe(r.b);
      expect(CITIES[r.a]).toBeTruthy();
      expect(CITIES[r.b]).toBeTruthy();
      expect(r.length).toBeGreaterThanOrEqual(1);
      expect(r.length).toBeLessThanOrEqual(6);
      expect(r.color).toBeGreaterThanOrEqual(0);
      expect(r.color).toBeLessThanOrEqual(8);
    }
  });
  it('граф связный, у двойников взаимные ссылки и совпадающие города', () => {
    const d = distances();
    for (let i = 0; i < CITIES.length; i++) for (let j = 0; j < CITIES.length; j++) expect(d[i]![j]).toBeLessThan(Infinity);
    ROUTES.forEach((r, i) => {
      if (r.twin !== undefined) {
        const t = ROUTES[r.twin]!;
        expect(t.twin).toBe(i);
        expect([t.a, t.b]).toEqual([r.a, r.b]);
        expect(t.length).toBe(r.length);
        expect(t.color).not.toBe(r.color);
      }
    });
  });
  it('билетов достаточно и все выполнимы', () => {
    expect(TICKETS.length).toBeGreaterThanOrEqual(30);
    const d = distances();
    for (const t of TICKETS) expect(d[t.a]![t.b]).toBeLessThan(Infinity);
  });
  it('координаты в пределах карты, названия уникальны', () => {
    expect(new Set(CITIES.map((c) => c.name)).size).toBe(CITIES.length);
    for (const c of CITIES) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThanOrEqual(100);
    }
  });
});
