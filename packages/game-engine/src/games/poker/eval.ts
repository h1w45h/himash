/**
 * Оценка покерных комбинаций.
 * Карта — число 0..51: ранг = c >> 2 (0 = двойка … 12 = туз), масть = c & 3.
 * Оценка комбинации — одно число: чем больше, тем сильнее. Формат: категория (4 бита) + 5 четырёхбитных кикеров.
 */
export const rankOf = (c: number) => c >> 2;
export const suitOf = (c: number) => c & 3;
export const makeCard = (rank: number, suit: number) => rank * 4 + suit;

export const CATEGORY_NAMES = [
  'Старшая карта', 'Пара', 'Две пары', 'Тройка', 'Стрит', 'Флеш', 'Фулл-хаус', 'Каре', 'Стрит-флеш',
] as const;

const score = (category: number, ranks: number[]) => {
  let v = category;
  for (let i = 0; i < 5; i++) v = (v << 4) | (ranks[i] ?? 0);
  return v;
};
export const categoryOf = (value: number) => value >> 20;
export const handName = (value: number) => {
  const cat = categoryOf(value);
  // Роял-флеш — стрит-флеш до туза.
  if (cat === 8 && ((value >> 16) & 15) === 12) return 'Роял-флеш';
  return CATEGORY_NAMES[cat] ?? '';
};

/** Старшая карта стрита в маске рангов (бит r = есть ранг r), или -1. «Колесо» A-2-3-4-5 даёт 3 (пятёрка). */
function straightHigh(mask: number): number {
  for (let high = 12; high >= 4; high--) {
    const need = 0b11111 << (high - 4);
    if ((mask & need) === need) return high;
  }
  // колесо: A,2,3,4,5 → биты 12,0,1,2,3
  if ((mask & 0b1111) === 0b1111 && (mask & (1 << 12))) return 3;
  return -1;
}

/** Лучшая пятикарточная комбинация из 5–7 карт. */
export function evaluate(cards: readonly number[]): number {
  const counts = new Array<number>(13).fill(0);
  const suitMask = [0, 0, 0, 0];
  const suitCount = [0, 0, 0, 0];
  let mask = 0;
  for (const c of cards) {
    const r = rankOf(c);
    const s = suitOf(c);
    counts[r]!++;
    suitMask[s]! |= 1 << r;
    suitCount[s]!++;
    mask |= 1 << r;
  }

  // Флеш и стрит-флеш
  for (let s = 0; s < 4; s++) {
    if (suitCount[s]! >= 5) {
      const sf = straightHigh(suitMask[s]!);
      if (sf >= 0) return score(8, [sf]);
      const top: number[] = [];
      for (let r = 12; r >= 0 && top.length < 5; r--) if (suitMask[s]! & (1 << r)) top.push(r);
      return score(5, top);
    }
  }

  const quads: number[] = [];
  const trips: number[] = [];
  const pairs: number[] = [];
  for (let r = 12; r >= 0; r--) {
    if (counts[r] === 4) quads.push(r);
    else if (counts[r] === 3) trips.push(r);
    else if (counts[r] === 2) pairs.push(r);
  }
  const kickers = (exclude: number[], n: number) => {
    const out: number[] = [];
    for (let r = 12; r >= 0 && out.length < n; r--) if (counts[r]! > 0 && !exclude.includes(r)) out.push(r);
    return out;
  };

  if (quads.length) return score(7, [quads[0]!, ...kickers([quads[0]!], 1)]);
  if (trips.length && (trips.length > 1 || pairs.length)) {
    // Фулл-хаус: старшая тройка + лучшая пара (в том числе из второй тройки).
    const pair = Math.max(pairs[0] ?? -1, trips[1] ?? -1);
    return score(6, [trips[0]!, pair]);
  }
  const st = straightHigh(mask);
  if (st >= 0) return score(4, [st]);
  if (trips.length) return score(3, [trips[0]!, ...kickers([trips[0]!], 2)]);
  if (pairs.length >= 2) return score(2, [pairs[0]!, pairs[1]!, ...kickers([pairs[0]!, pairs[1]!], 1)]);
  if (pairs.length === 1) return score(1, [pairs[0]!, ...kickers([pairs[0]!], 3)]);
  return score(0, kickers([], 5));
}

const RANK_CH = '23456789TJQKA';
const SUIT_CH = '♣♦♥♠';
export const cardLabel = (c: number) => `${RANK_CH[rankOf(c)]}${SUIT_CH[suitOf(c)]}`;
