import { Stack, useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { usePublicRooms } from '@/api/rooms';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

export default function RoomsList() {
  const { colors } = useTheme();
  const router = useRouter();
  const { data, isFetching, refetch, error } = usePublicRooms();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerShown: true, title: 'Открытые комнаты', headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text }} />
      <FlatList
        data={data ?? []}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: 20, gap: 12 }}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.primary} />}
        ListEmptyComponent={
          <Text style={{ color: colors.textMuted, textAlign: 'center', marginTop: 40 }}>
            {error ? error.message : 'Открытых комнат пока нет. Создайте свою!'}
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/room/${item.code}`)}
            style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.border, gap: 4 }}
          >
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>
              {item.game.title} {item.hasPassword ? '🔒' : ''}
            </Text>
            <Text style={{ color: colors.textMuted }}>
              Хозяин: {item.host.displayName} · {item.players.length}/{item.maxPlayers}
              {item.isRated ? ' · рейтинговая' : ''}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}
