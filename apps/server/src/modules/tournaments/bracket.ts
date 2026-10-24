/** Чистая логика турнирной сетки (олимпийская система). */

export const nextPow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(n, 2)));

/** Порядок сеяных по сетке: 1 играет с последним, 2 — со вторым с конца и т.д.; сильнейшие встречаются лишь в финале. */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

export interface Slot {
  /** Индекс игрока в списке, упорядоченном по сеянию, или null (проход без соперника). */
  a: number | null;
  b: number | null;
}

/** Пары первого раунда для `count` игроков (игроки пронумерованы по сеянию: 0 — сильнейший). */
export function firstRound(count: number): Slot[] {
  const size = nextPow2(count);
  const order = seedOrder(size);
  const slots: Slot[] = [];
  for (let i = 0; i < size; i += 2) {
    const a = (order[i] as number) - 1;
    const b = (order[i + 1] as number) - 1;
    slots.push({ a: a < count ? a : null, b: b < count ? b : null });
  }
  return slots;
}

export const roundsCount = (size: number) => Math.log2(size);

/** Куда идёт победитель матча: (раунд + 1, позиция / 2), слот 0 или 1. */
export const nextOf = (round: number, position: number) => ({ round: round + 1, position: Math.floor(position / 2), slot: position % 2 });

/** Итоговое место проигравшего в раунде `round` (общее для всех, выбывших в этом раунде). */
export const placementForLoser = (size: number, round: number) => size / 2 ** round + 1;

/**
 * Призы из собранных взносов: 60% победителю, 25% финалисту, 15% поровну полуфиналистам.
 * Остаток от округления уходит победителю. Если полуфиналистов нет (сетка из 2 игроков) — их доля финалисту.
 */
export function splitPrize(pool: number, semifinalists: number): { first: number; second: number; semi: number } {
  if (pool <= 0) return { first: 0, second: 0, semi: 0 };
  const semiShare = semifinalists > 0 ? Math.floor((pool * 0.15) / semifinalists) : 0;
  const second = Math.floor(pool * 0.25) + (semifinalists > 0 ? 0 : Math.floor(pool * 0.15));
  return { first: pool - second - semiShare * semifinalists, second, semi: semiShare };
}
