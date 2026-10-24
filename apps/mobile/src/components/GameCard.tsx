import { Pressable, Text, View } from 'react-native';
import { CATEGORY_TITLES } from '@nastolki/shared';
import type { GameListItem } from '@/api/games';
import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

export function playersLabel(g: Pick<GameListItem, 'minPlayers' | 'maxPlayers'>) {
  return g.minPlayers === g.maxPlayers ? `${g.minPlayers} игрока` : `${g.minPlayers}–${g.maxPlayers} игроков`;
}

const COMPLEXITY = ['', 'Очень просто', 'Просто', 'Средне', 'Сложно', 'Очень сложно'];
export const complexityLabel = (n: number) => COMPLEXITY[n] ?? '';

export function GameCard({ game, onPress }: { game: GameListItem; onPress: () => void }) {
  const { colors } = useTheme();
  const soon = game.status === 'PLANNED';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.lg,
        gap: spacing.xs,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: colors.text, fontSize: 19, fontWeight: '700', flexShrink: 1 }}>{game.title}</Text>
        {soon && (
          <Text style={{ color: colors.onPrimary, backgroundColor: colors.primary, fontSize: 12, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: 'hidden' }}>
            Скоро
          </Text>
        )}
      </View>
      <Text style={{ color: colors.textMuted, fontSize: 14 }}>{game.tagline}</Text>
      <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 4 }}>
        {CATEGORY_TITLES[game.category]} · {playersLabel(game)} · ~{game.avgMinutes} мин
      </Text>
    </Pressable>
  );
}
