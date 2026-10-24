import { useLocalSearchParams } from 'expo-router';
import { useGame } from '@/api/games';
import { LocalMatchScreen } from '@/components/LocalMatchScreen';
import type { BotLevelKey } from '@/games/meta';

/** Партия с ботом: /bot/chess?level=HARD&second=1 (second=1 — игрок ходит вторым). */
export default function BotMatch() {
  const { slug, level = 'MEDIUM', second, variant, players } = useLocalSearchParams<{ slug: string; level?: BotLevelKey; second?: string; variant?: string; players?: string }>();
  const { data: game } = useGame(slug);
  if (!game) return null;
  const humanSeat = second === '1' ? 1 : 0;
  // Бот занимает все места, кроме человеческого (в играх на 3+ игроков — несколько ботов).
  const n = Math.min(Math.max(Number(players) || 2, game.minPlayers), game.maxPlayers);
  const bots = Object.fromEntries(Array.from({ length: n }, (_, i) => i).filter((i) => i !== (n > 2 ? 0 : humanSeat)).map((i) => [i, level]));
  return (
    <LocalMatchScreen
      title={`${game.title} · против бота`}
      cfg={{ slug, players: n, bots, variant, hiddenInfo: false, saveKey: `bot:${slug}:${n}:${variant ?? ''}:${humanSeat}` }}
    />
  );
}
