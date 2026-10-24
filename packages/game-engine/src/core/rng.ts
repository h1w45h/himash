/**
 * Детерминированный генератор случайных чисел (mulberry32).
 * Сид хранится в Match.seed, поэтому партию можно воспроизвести из журнала ходов
 * и на клиенте, и на сервере с одинаковым результатом.
 */
export interface Rng {
  /** Число в [0, 1). */
  next(): number;
  /** Целое в [0, max). */
  int(max: number): number;
  /** Новый массив, перемешанный по Фишеру–Йетсу. */
  shuffle<T>(items: readonly T[]): T[];
  /** Текущее внутреннее состояние — сохраняется в снапшоте, чтобы продолжить последовательность. */
  readonly state: number;
}

/** Строковый сид → 32-битное число (FNV-1a). */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRng(seed: string | number): Rng {
  let s = typeof seed === 'string' ? hashSeed(seed) : seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (max) => Math.floor(next() * max),
    shuffle: (items) => {
      const a = items.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j] as (typeof a)[number], a[i] as (typeof a)[number]];
      }
      return a;
    },
    get state() {
      return s;
    },
  };
}
