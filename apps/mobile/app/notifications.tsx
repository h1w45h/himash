import { useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { FlatList, Pressable, Text } from 'react-native';
import { api } from '@/api/client';
import { useNotifications, type NotificationItem } from '@/api/social';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

export default function Notifications() {
  const { colors } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { data } = useNotifications();

  // Открыли центр уведомлений — всё считается прочитанным.
  useEffect(() => {
    if (data && data.unread > 0) void api('/notifications/read', { method: 'POST', json: {} }).then(() => qc.invalidateQueries({ queryKey: ['notifications'] }));
  }, [data, qc]);

  const open = (n: NotificationItem) => {
    const d = n.data ?? {};
    if (d.roomCode) router.push(`/room/${d.roomCode}`);
    else if (n.type.startsWith('FRIEND')) router.push('/(tabs)/friends');
  };

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 20, gap: 10 }}
      data={data?.items ?? []}
      keyExtractor={(n) => n.id}
      ListHeaderComponent={<Stack.Screen options={{ headerShown: true, title: 'Уведомления', headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text }} />}
      ListEmptyComponent={<Text style={{ color: colors.textMuted, textAlign: 'center', marginTop: 40 }}>Уведомлений нет</Text>}
      renderItem={({ item }) => (
        <Pressable onPress={() => open(item)} style={{ padding: 12, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: item.readAt ? colors.border : colors.primary }}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>{item.title}</Text>
          <Text style={{ color: colors.textMuted }}>{item.body}</Text>
          <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 4 }}>{new Date(item.createdAt).toLocaleString('ru-RU')}</Text>
        </Pressable>
      )}
    />
  );
}
