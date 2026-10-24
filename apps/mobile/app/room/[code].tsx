import { useAuth } from '@/auth/session';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, ScrollView, Share, Text, View } from 'react-native';
import { useMe } from '@/api/users';
import { ChatPanel } from '@/components/ChatPanel';
import { useRoomLive } from '@/realtime/useRoomLive';
import { useRoom, useRoomActions } from '@/api/rooms';
import { Button, ErrorText } from '@/components/ui';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

export default function RoomLobby() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const me = useMe(!!isSignedIn);
  const { data: room, error, isLoading } = useRoom(code);
  const actions = useRoomActions(code);
  useRoomLive(code);

  // Партия началась — переходим к игре.
  useEffect(() => {
    if (room?.matchId && room.status === 'IN_PROGRESS') router.replace(`/match/${room.matchId}`);
  }, [room?.matchId, room?.status, router]);

  if (isLoading || !me.data) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator color={colors.primary} /></View>;
  if (!room) return <Text style={{ color: colors.danger, padding: 24 }}>{error?.message ?? 'Комната не найдена'}</Text>;

  const myId = me.data.id;
  const isHost = room.hostId === myId;
  const mine = room.players.find((p) => p.user?.id === myId);
  const allReady = room.players.every((p) => p.isReady);
  const canStart = isHost && room.players.length >= room.minPlayers && allReady;
  const err = actions.start.error ?? actions.join.error ?? actions.ready.error ?? actions.addBot.error ?? actions.kick.error;

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 20, gap: 16 }}>
      <Stack.Screen options={{ headerShown: true, title: room.game.title, headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text }} />
      <View style={{ alignItems: 'center', gap: 4 }}>
        <Text style={{ color: colors.textMuted }}>Код комнаты</Text>
        <Text selectable style={{ color: colors.text, fontSize: 40, fontWeight: '800', letterSpacing: 6 }}>{room.code}</Text>
        <Button title="Поделиться кодом" variant="secondary" onPress={() => Share.share({ message: `Играем в «${room.game.title}»! Код комнаты в «Настолках Онлайн»: ${room.code}` })} />
      </View>

      {Array.from({ length: room.maxPlayers }, (_, seat) => {
        const p = room.players.find((x) => x.seat === seat);
        return (
          <View key={seat} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, borderWidth: 1, borderColor: colors.border }}>
            <View>
              <Text style={{ color: p ? colors.text : colors.textMuted, fontSize: 16, fontWeight: '600' }}>
                {p ? (p.isBot ? `🤖 Бот (${p.botLevel})` : p.user?.displayName) : 'Свободное место'}
                {p?.user?.id === room.hostId ? ' 👑' : ''}
              </Text>
              {p && <Text style={{ color: p.isReady ? colors.success : colors.textMuted }}>{p.isReady ? 'Готов' : 'Не готов'}</Text>}
            </View>
            {isHost && p && p.user?.id !== myId && (
              <Button title="Убрать" variant="secondary" onPress={() => actions.kick.mutate(seat)} />
            )}
          </View>
        );
      })}

      <ErrorText>{err?.message}</ErrorText>

      {mine && <ChatPanel scope="ROOM" target={room.code} myUserId={myId} />}

      {isHost ? (
        <>
          {room.players.length < room.maxPlayers && <Button title="Добавить бота" variant="secondary" onPress={() => actions.addBot.mutate()} />}
          <Button title="Начать игру" onPress={() => actions.start.mutate()} disabled={!canStart} loading={actions.start.isPending} />
        </>
      ) : (
        mine && <Button title={mine.isReady ? 'Не готов' : 'Готов'} onPress={() => actions.ready.mutate(!mine.isReady)} />
      )}
      <Button
        title="Выйти из комнаты"
        variant="secondary"
        onPress={() => actions.leave.mutate(undefined, { onSettled: () => router.replace('/(tabs)/play') })}
      />
    </ScrollView>
  );
}
