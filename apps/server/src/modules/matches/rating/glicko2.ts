/**
 * Рейтинг Glicko-2 (Марк Глик­ман, 2013).
 * Шкала хранения — привычная (1500 ± ...), внутри пересчитывается в шкалу μ/φ.
 */
export interface RatingState {
  rating: number;
  deviation: number;
  volatility: number;
}

const SCALE = 173.7178;
const TAU = 0.5; // ограничивает скорость изменения волатильности
const EPS = 1e-6;

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const E = (mu: number, muJ: number, phiJ: number) => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

export interface GameResult {
  opponent: RatingState;
  /** 1 — победа, 0.5 — ничья, 0 — поражение. */
  score: number;
}

export function glicko2Update(p: RatingState, results: GameResult[]): RatingState {
  const mu = (p.rating - 1500) / SCALE;
  let phi = p.deviation / SCALE;
  const sigma = p.volatility;

  // Нет партий — только растёт неопределённость (шаг 6 алгоритма).
  if (results.length === 0) {
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    return { ...p, deviation: Math.min(phiStar * SCALE, 350) };
  }

  let vInv = 0;
  let deltaSum = 0;
  for (const r of results) {
    const muJ = (r.opponent.rating - 1500) / SCALE;
    const phiJ = r.opponent.deviation / SCALE;
    const e = E(mu, muJ, phiJ);
    vInv += g(phiJ) ** 2 * e * (1 - e);
    deltaSum += g(phiJ) * (r.score - e);
  }
  const v = 1 / vInv;
  const delta = v * deltaSum;

  // Новая волатильность — итерация Иллинойс (шаг 5).
  const a = Math.log(sigma * sigma);
  const f = (x: number) => {
    const ex = Math.exp(x);
    const d = phi * phi + v + ex;
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * d * d) - (x - a) / (TAU * TAU);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > EPS) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  const sigmaNew = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi * phi + sigmaNew * sigmaNew);
  phi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phi * phi * deltaSum;

  return {
    rating: muNew * SCALE + 1500,
    deviation: Math.min(phi * SCALE, 350),
    volatility: sigmaNew,
  };
}

export interface RatedPlayer {
  seat: number;
  state: RatingState;
  /** Занятое место: 1 — лучшее. Равные места = ничья. */
  place: number;
}

/**
 * Обновление рейтингов по итогам партии любого размера: каждый игрок «играет»
 * попарно со всеми остальными, счёт определяется взаимным порядком мест.
 */
export function rateMatch(players: RatedPlayer[]): Map<number, RatingState> {
  const out = new Map<number, RatingState>();
  for (const me of players) {
    const results: GameResult[] = players
      .filter((o) => o.seat !== me.seat)
      .map((o) => ({
        opponent: o.state,
        score: me.place < o.place ? 1 : me.place === o.place ? 0.5 : 0,
      }));
    out.set(me.seat, glicko2Update(me.state, results));
  }
  return out;
}
