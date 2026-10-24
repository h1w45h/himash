import { CATEGORY_TITLES } from '@nastolki/shared';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useGame } from '@/api/games';
import { complexityLabel, playersLabel } from '@/components/GameCard';
import { Markdown } from '@/components/Markdown';
import { Button } from '@/components/ui';
import { BOT_LEVELS, type BotLevelKey } from '@/games/meta';
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
  const router = useRouter();
  const [level, setLevel] = useState<BotLevelKey>('MEDIUM');
  const [second, setSecond] = useState(false);
  const [variant, setVariant] = useState<string | undefined>(undefined);
  const [players, setPlayers] = useState<number | null>(null);
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
          <View style={{ gap: 6 }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>Вариант</Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {game.variants.map((v) => (
                <Button key={v.key} title={v.title} variant={(variant ?? game.variants?.[0]?.key) === v.key ? 'primary' : 'secondary'} onPress={() => setVariant(v.key)} />
              ))}
            </View>
          </View>
        )}
        {game.maxPlayers > game.minPlayers && !soon && (
          <View style={{ gap: 6 }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>Игроков для локальной игры: {players ?? game.minPlayers}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="−" variant="secondary" disabled={(players ?? game.minPlayers) <= game.minPlayers} onPress={() => setPlayers((players ?? game.minPlayers) - 1)} />
              <Button title="+" variant="secondary" disabled={(players ?? game.minPlayers) >= game.maxPlayers} onPress={() => setPlayers((players ?? game.minPlayers) + 1)} />
            </View>
          </View>
        )}
        <View style={{ gap: 10 }}>
          {soon && <Text style={{ color: colors.textMuted }}>Игра появится в одном из ближайших обновлений.</Text>}
          {game.supportsOnline && <Button title="Играть онлайн" onPress={() => router.push({ pathname: '/matchmaking', params: { game: slug, variant: variant ?? game.variants?.[0]?.key } })} disabled={soon} />}
          {game.supportsOnline && <Button title="Создать комнату" variant="secondary" onPress={() => router.push({ pathname: '/rooms/create', params: { game: slug } })} disabled={soon} />}
          {game.supportsLocal && <Button title="На одном устройстве" variant="secondary" onPress={() => router.push({ pathname: '/local/[slug]', params: { slug, players: String(players ?? game.minPlayers), variant: variant ?? game.variants?.[0]?.key } })} disabled={soon} />}
          {game.hasBots && !soon && (
            <View style={{ gap: 8, backgroundColor: colors.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Против бота</Text>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                {BOT_LEVELS.map((l) => (
                  <Button key={l.level} title={l.title} variant={level === l.level ? 'primary' : 'secondary'} onPress={() => setLevel(l.level)} />
                ))}
              </View>
              <Button title={second ? 'Я хожу вторым' : 'Я хожу первым'} variant="secondary" onPress={() => setSecond((v) => !v)} />
              <Button title="Играть с ботом" onPress={() => router.push({ pathname: '/bot/[slug]', params: { slug, level, second: second ? '1' : '0', players: String(players ?? 2), variant: variant ?? game.variants?.[0]?.key } })} />
            </View>
          )}
        </View>
        {!soon && game.isRated && <Button title="Таблица лидеров" variant="secondary" onPress={() => router.push(`/leaderboard/${slug}`)} />}
        <Text style={{ color: colors.text, fontSize: 24, fontWeight: '800', marginTop: 8 }}>Правила</Text>
        <Markdown source={game.rulesMarkdown} />
      </ScrollView>
    </>
  );
}
