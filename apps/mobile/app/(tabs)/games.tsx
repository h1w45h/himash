import { CATEGORY_TITLES, type GameCategory } from '@nastolki/shared';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useGames } from '@/api/games';
import { GameCard } from '@/components/GameCard';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

const PLAYER_FILTERS = [2, 3, 4, 5, 6] as const;

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityState={{ selected: active }}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: active ? colors.primary : colors.surface,
        borderWidth: 1,
        borderColor: active ? colors.primary : colors.border,
      }}
    >
      <Text style={{ color: active ? colors.onPrimary : colors.text, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export default function GamesScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { data } = useGames();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<GameCategory | null>(null);
  const [players, setPlayers] = useState<number | null>(null);

  // Фильтрация на клиенте: каталог маленький, а так работает мгновенно и без сети.
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? []).filter(
      (g) =>
        (!category || g.category === category) &&
        (!players || (g.minPlayers <= players && g.maxPlayers >= players)) &&
        (!needle || g.title.toLowerCase().includes(needle) || g.tagline.toLowerCase().includes(needle)),
    );
  }, [data, q, category, players]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{ padding: 20, gap: 12 }}>
        <Text style={{ color: colors.text, fontSize: 28, fontWeight: '800' }}>Игры</Text>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Поиск игры"
          placeholderTextColor={colors.textMuted}
          style={{ height: 46, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: 14, fontSize: 16 }}
        />
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={Object.keys(CATEGORY_TITLES) as GameCategory[]}
          keyExtractor={(c) => c}
          contentContainerStyle={{ gap: 8 }}
          renderItem={({ item }) => (
            <Chip label={CATEGORY_TITLES[item]} active={category === item} onPress={() => setCategory(category === item ? null : item)} />
          )}
        />
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={PLAYER_FILTERS}
          keyExtractor={(n) => String(n)}
          contentContainerStyle={{ gap: 8 }}
          renderItem={({ item }) => (
            <Chip label={`${item} игрока`.replace('5 игрока', '5 игроков').replace('6 игрока', '6 игроков')} active={players === item} onPress={() => setPlayers(players === item ? null : item)} />
          )}
        />
      </View>
      <FlatList
        data={items}
        keyExtractor={(g) => g.slug}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, gap: 12 }}
        renderItem={({ item }) => <GameCard game={item} onPress={() => router.push(`/game/${item.slug}`)} />}
        ListEmptyComponent={
          <Text style={{ color: colors.textMuted, textAlign: 'center', marginTop: 40 }}>Ничего не найдено</Text>
        }
      />
    </SafeAreaView>
  );
}
