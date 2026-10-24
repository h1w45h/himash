export interface Ticket {
  userId: string;
  rating: number;
  joinedAt: number;
}

/** Окно подбора по рейтингу: ±100 сразу, растёт до ±400 за 30 секунд ожидания. */
export function ratingWindow(waitedMs: number): number {
  const t = Math.min(Math.max(waitedMs, 0) / 30_000, 1);
  return Math.round(100 + 300 * t);
}

/** Группа неполного размера допускается, только если все ждут не меньше этого времени. */
const PARTIAL_GROUP_WAIT_MS = 15_000;

/**
 * Формирует группы игроков из очереди одной игры.
 * Билеты сортируются по рейтингу; ищем окна подряд идущих игроков, у которых разброс рейтинга
 * укладывается в наименьшее окно среди участников. Размеры пробуем от максимального к минимальному.
 */
export function formGroups(tickets: Ticket[], minPlayers: number, maxPlayers: number, now: number): Ticket[][] {
  const pool = [...tickets].sort((a, b) => a.rating - b.rating || a.joinedAt - b.joinedAt);
  const groups: Ticket[][] = [];

  for (let size = maxPlayers; size >= minPlayers; size--) {
    for (let i = 0; i + size <= pool.length; ) {
      const slice = pool.slice(i, i + size);
      const first = slice[0];
      const last = slice[slice.length - 1];
      if (!first || !last) break;
      const spread = last.rating - first.rating;
      const window = Math.min(...slice.map((t) => ratingWindow(now - t.joinedAt)));
      const waitedEnough = size === maxPlayers || slice.every((t) => now - t.joinedAt >= PARTIAL_GROUP_WAIT_MS);
      if (spread <= window && waitedEnough) {
        groups.push(slice);
        pool.splice(i, size); // игроки использованы — убираем из пула
      } else {
        i++;
      }
    }
  }
  return groups;
}
