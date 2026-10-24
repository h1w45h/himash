import { CATEGORY_TITLES } from '@nastolki/shared';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useGame } from '@/api/games';
import { complexityLabel, playersLabel } from '@/components/GameCard';
import { Markdown } from '@/components/Markdown';
import { Button } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

function Fact({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border }}>
      <Text style={{ color: colors.textMuted, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: colors.text, fontWeight: '700', marginTop: 2 }}>{value}</Text>
    </View>
  );
}

export default function GameScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { colors } = useTheme();
  const { data: game, isLoading } = useGame(slug);

  if (!game) {
    return <View style={{ flex: 1, justifyContent: 'center' }}>{isLoading ? <ActivityIndicator color={colors.primary} /> : <Text style={{ color: colors.text, textAlign: 'center' }}>Игра не найдена</Text>}</View>;
  }

  const soon = game.status === 'PLANNED';
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: game.title, headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text }} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <Text style={{ color: colors.textMuted, fontSize: 16 }}>{game.description}</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Fact label="Игроков" value={playersLabel(game).replace(' игроков', '').replace(' игрока', '')} />
          <Fact label="Время" value={`~${game.avgMinutes} мин`} />
          <Fact label="Сложность" value={complexityLabel(game.complexity)} />
        </View>
        <Text style={{ color: colors.textMuted }}>{CATEGORY_TITLES[game.category]}</Text>
        {game.variants && (
          <Text style={{ color: colors.text }}>Варианты: {game.variants.map((v) => v.title).join(', ')}</Text>
        )}
        <View style={{ gap: 10 }}>
          {soon && <Text style={{ color: colors.textMuted }}>Игра появится в одном из ближайших обновлений.</Text>}
          {game.supportsOnline && <Button title="Играть онлайн" onPress={() => {}} disabled={soon} />}
          {game.hasBots && <Button title="Против бота" variant="secondary" onPress={() => {}} disabled={soon} />}
          {game.supportsLocal && <Button title="На одном устройстве" variant="secondary" onPress={() => {}} disabled={soon} />}
        </View>
        <Text style={{ color: colors.text, fontSize: 24, fontWeight: '800', marginTop: 8 }}>Правила</Text>
        <Markdown source={game.rulesMarkdown} />
      </ScrollView>
    </>
  );
}
