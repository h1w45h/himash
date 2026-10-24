import { cardGames } from './card';
import { classicGames } from './classic';
import { partyGames } from './party';
import { strategyGames } from './strategy';
import type { CatalogGame } from './types';

export * from './types';

/** Порядок в каталоге = порядок в массиве (sortOrder = индекс). */
export const CATALOG: CatalogGame[] = [...classicGames, ...cardGames, ...strategyGames, ...partyGames];

/**
 * Таймер хода по умолчанию (секунды) для игр, где без него партия может зависнуть:
 * общие фазы с обсуждением и голосованием, одновременные ходы.
 */
export const DEFAULT_TURN_SEC: Record<string, number> = {
  mafia: 90, bunker: 90, codenames: 120, alias: 90, dixit: 90, imaginarium: 90, svintus: 45, preferans: 90,
};
