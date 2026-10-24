import { useLocalSearchParams } from 'expo-router';
import { useGame } from '@/api/games';
import { LocalMatchScreen } from '@/components/LocalMatchScreen';
import type { BotLevelKey } from '@/games/meta';

/** Партия с ботом: /bot/chess?level=HARD&second=1 (second=1 — игрок ходит вторым). */
export default function BotMatch() {
  const { slug, level = 'MEDIUM', second } = useLocalSearchParams<{ slug: string; level?: BotLevelKey; second?: string }>();
  const { data: game } = useGame(slug);
  if (!game) return null;
  const humanSeat = second === '1' ? 1 : 0;
  const botSeat = 1 - humanSeat;
  return (
    <LocalMatchScreen
      title={`${game.title} · против бота`}
      cfg={{ slug, players: 2, bots: { [botSeat]: level }, saveKey: `bot:${slug}:${humanSeat}` }}
    />
  );
}
