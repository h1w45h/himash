import { useQuery } from '@tanstack/react-query';
import { CATALOG, type CatalogGame } from '@nastolki/shared';
import { api } from './client';

/** Игра в том виде, в каком её отдаёт API (+ слитые поля офлайн-каталога). */
export type GameListItem = Omit<CatalogGame, 'rulesMarkdown'> & { id?: string; coverUrl?: string | null };

const bundled: GameListItem[] = CATALOG.map(({ rulesMarkdown: _r, ...g }) => g);

/**
 * Каталог доступен без сети: при ошибке запроса используем встроенную копию.
 * Так экран «Игры» и правила работают в самолёте и в метро.
 */
export function useGames() {
  return useQuery({
    queryKey: ['games'],
    queryFn: async (): Promise<GameListItem[]> => {
      try {
        return await api<GameListItem[]>('/games');
      } catch {
        return bundled;
      }
    },
    placeholderData: bundled,
    staleTime: 5 * 60_000,
  });
}

export function useGame(slug: string) {
  return useQuery({
    queryKey: ['games', slug],
    queryFn: async (): Promise<CatalogGame> => {
      try {
        return await api<CatalogGame>(`/games/${slug}`);
      } catch {
        const g = CATALOG.find((x) => x.slug === slug);
        if (!g) throw new Error('Игра не найдена');
        return g;
      }
    },
    placeholderData: CATALOG.find((x) => x.slug === slug),
  });
}
