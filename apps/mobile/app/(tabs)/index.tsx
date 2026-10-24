import { useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useGames } from '@/api/games';
import { useMe } from '@/api/users';
import { GameCard } from '@/components/GameCard';
import { useTheme } from '@/theme/useTheme';

export default function Home() {
  const { colors } = useTheme();
  const router = useRouter();
  const me = useMe();
  const games = useGames();
  const popular = games.data?.filter((g) => ['chess', 'durak', 'monopoly'].includes(g.slug)) ?? [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <View>
          <Text style={{ color: colors.text, fontSize: 26, fontWeight: '800' }}>
            {me.data ? `Привет, ${me.data.displayName}!` : 'Добро пожаловать!'}
          </Text>
          {me.data && <Text style={{ color: colors.textMuted }}>🪙 {me.data.wallet?.coins ?? 0}</Text>}
          {me.isLoading && <ActivityIndicator color={colors.primary} />}
        </View>
        <Text style={{ color: colors.text, fontSize: 19, fontWeight: '700' }}>Популярное</Text>
        {popular.map((g) => (
          <GameCard key={g.slug} game={g} onPress={() => router.push(`/game/${g.slug}`)} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
