import type { AnyGame } from './types';

const games = new Map<string, AnyGame>();

/** Регистрирует игру. Дубликат slug — ошибка конфигурации, ловим на старте. */
export function registerGame(game: AnyGame): void {
  if (games.has(game.slug)) throw new Error(`Игра «${game.slug}» уже зарегистрирована`);
  games.set(game.slug, game);
}

export function getGame(slug: string): AnyGame {
  const g = games.get(slug);
  if (!g) throw new Error(`Неизвестная игра: ${slug}`);
  return g;
}

export const listGames = (): AnyGame[] => [...games.values()];
