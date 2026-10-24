import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useLeaderboard } from '@/api/social';
import { Avatar } from '@/components/Avatar';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

export default function Leaderboard() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const { data } = useLeaderboard(slug);
  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 20, gap: 8 }}
      data={data ?? []}
      keyExtractor={(r) => r.user.id}
      ListHeaderComponent={<Stack.Screen options={{ headerShown: true, title: 'Рейтинг', headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text }} />}
      ListEmptyComponent={<Text style={{ color: colors.textMuted, textAlign: 'center', marginTop: 40 }}>Рейтинговых партий ещё не было</Text>}
      renderItem={({ item, index }) => (
        <Pressable onPress={() => router.push(`/user/${item.user.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
          <Text style={{ width: 28, color: index < 3 ? colors.primary : colors.textMuted, fontWeight: '800', fontSize: 16 }}>{index + 1}</Text>
          <Avatar name={item.user.displayName} url={item.user.avatarUrl} avatarId={item.user.avatarId} size={36} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: '600' }}>{item.user.displayName}</Text>
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>{item.wins}–{item.losses}–{item.draws}</Text>
          </View>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18 }}>{item.rating}</Text>
        </Pressable>
      )}
    />
  );
}
