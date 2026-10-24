import { useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/api/client';
import { usePublicProfile } from '@/api/social';
import { useMe } from '@/api/users';
import { ChatPanel } from '@/components/ChatPanel';
import { useTheme } from '@/theme/useTheme';

/** Личная переписка с другом. При открытии отмечает сообщения прочитанными. */
export default function DirectChat() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const me = useMe();
  const peer = usePublicProfile(userId);

  useEffect(() => {
    void api(`/chat/direct/${userId}/read`, { method: 'POST' }).then(() => qc.invalidateQueries({ queryKey: ['friends'] })).catch(() => undefined);
  }, [userId, qc]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, padding: 12 }} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: peer.data?.displayName ?? 'Чат', headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text }} />
      <View style={{ flex: 1 }}>{me.data && <ChatPanel scope="DIRECT" target={userId} myUserId={me.data.id} />}</View>
    </SafeAreaView>
  );
}
