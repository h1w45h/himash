import { cardGames } from './card';
import { classicGames } from './classic';
import { partyGames } from './party';
import { strategyGames } from './strategy';
import type { CatalogGame } from './types';

export * from './types';

/** Порядок в каталоге = порядок в массиве (sortOrder = индекс). */
export const CATALOG: CatalogGame[] = [...classicGames, ...cardGames, ...strategyGames, ...partyGames];
