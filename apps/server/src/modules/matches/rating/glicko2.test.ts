import { describe, expect, it } from 'vitest';
import { glicko2Update, rateMatch } from './glicko2';

describe('glicko2', () => {
  it('совпадает с примером из статьи Глик­мана', () => {
    const r = glicko2Update(
      { rating: 1500, deviation: 200, volatility: 0.06 },
      [
        { opponent: { rating: 1400, deviation: 30, volatility: 0.06 }, score: 1 },
        { opponent: { rating: 1550, deviation: 100, volatility: 0.06 }, score: 0 },
        { opponent: { rating: 1700, deviation: 300, volatility: 0.06 }, score: 0 },
      ],
    );
    expect(r.rating).toBeCloseTo(1464.06, 1);
    expect(r.deviation).toBeCloseTo(151.52, 1);
    expect(r.volatility).toBeCloseTo(0.05999, 4);
  });

  it('победитель растёт, проигравший падает', () => {
    const base = { rating: 1200, deviation: 350, volatility: 0.06 };
    const m = rateMatch([
      { seat: 0, state: base, place: 1 },
      { seat: 1, state: base, place: 2 },
    ]);
    expect(m.get(0)!.rating).toBeGreaterThan(1200);
    expect(m.get(1)!.rating).toBeLessThan(1200);
  });
});
