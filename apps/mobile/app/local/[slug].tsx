import { useLocalSearchParams } from 'expo-router';
import { useGame } from '@/api/games';
import { LocalMatchScreen } from '@/components/LocalMatchScreen';

/** Игра на одном устройстве: /local/chess?players=2 */
export default function LocalMatch() {
  const { slug, players, variant } = useLocalSearchParams<{ slug: string; players?: string; variant?: string }>();
  const { data: game } = useGame(slug);
  if (!game) return null;
  const n = Math.min(Math.max(Number(players) || game.minPlayers, game.minPlayers), game.maxPlayers);
  return (
    <LocalMatchScreen
      title={`${game.title} · на одном устройстве`}
      cfg={{ slug, players: n, variant, hiddenInfo: game.hiddenInfo, saveKey: `local:${slug}:${n}:${variant ?? ''}` }}
    />
  );
}
