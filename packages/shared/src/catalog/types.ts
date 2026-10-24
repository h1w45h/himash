export type GameCategory = 'CLASSIC' | 'CARD' | 'STRATEGY' | 'PARTY';
export type GameImplStatus = 'PLANNED' | 'BETA' | 'RELEASED';

export interface GameVariant {
  key: string;
  title: string;
}

/** Описание игры каталога. Единый источник: seed БД и офлайн-каталог в приложении. */
export interface CatalogGame {
  slug: string;
  title: string;
  tagline: string;
  description: string;
  rulesMarkdown: string;
  category: GameCategory;
  minPlayers: number;
  maxPlayers: number;
  avgMinutes: number;
  complexity: 1 | 2 | 3 | 4 | 5;
  hasBots: boolean;
  supportsLocal: boolean;
  supportsOnline: boolean;
  isRated: boolean;
  variants?: GameVariant[];
  status: GameImplStatus;
}

export const CATEGORY_TITLES: Record<GameCategory, string> = {
  CLASSIC: 'Классика',
  CARD: 'Карточные',
  STRATEGY: 'Стратегии',
  PARTY: 'Пати-игры',
};
