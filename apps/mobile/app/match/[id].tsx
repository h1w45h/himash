import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMe } from '@/api/users';
import { ChatPanel } from '@/components/ChatPanel';
import { Button, ErrorText } from '@/components/ui';
import { GAME_UIS } from '@/games/registry';
import { GenericBoard } from '@/games/GenericBoard';
import { reasonText } from '@/games/meta';
import { feedback } from '@/services/feedback';
import { useCountdown, useMatch } from '@/realtime/useMatch';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

export default function MatchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const me = useMe();
  const { snap, error, pending, connected, myTurn, sendAction, resign } = useMatch(id);
  const left = useCountdown(snap?.turnDeadline ?? null);
  const [chat, setChat] = useState(false);

  // Звук: «ваш ход» и итог партии
  useEffect(() => {
    if (myTurn) feedback.notify();
  }, [myTurn]);
  const finishedStatus = snap?.status !== 'IN_PROGRESS' ? snap?.status : null;
  useEffect(() => {
    if (!snap || !finishedStatus) return;
    (snap.seat !== null && snap.outcome?.winners.includes(snap.seat) ? feedback.win : feedback.lose)();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishedStatus]);

  if (!snap) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: 24 }}>
        {error ? <ErrorText>{error}</ErrorText> : <ActivityIndicator color={colors.primary} />}
      </SafeAreaView>
    );
  }

  const Board = GAME_UIS[snap.gameSlug] ?? GenericBoard;
  const finished = snap.status !== 'IN_PROGRESS';
  const mine = snap.players.find((p) => p.seat === snap.seat);

  const confirmResign = () =>
    Alert.alert('Сдаться?', 'Партия будет засчитана как поражение.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Сдаться', style: 'destructive', onPress: () => void resign() },
    ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: 'Партия', headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text, headerBackVisible: finished }} />

      {!connected && (
        <Text style={{ backgroundColor: colors.danger, color: '#fff', textAlign: 'center', padding: 6 }}>Нет соединения — переподключаемся…</Text>
      )}

      <View style={{ flexDirection: 'row', gap: 8, padding: 12 }}>
        {snap.players.map((p) => {
          const active = snap.currentSeats.includes(p.seat) && !finished;
          return (
            <View key={p.seat} style={{ flex: 1, padding: 10, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 2, borderColor: active ? colors.primary : colors.border }}>
              <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '700' }}>{p.displayName}{p.seat === snap.seat ? ' (вы)' : ''}</Text>
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>{active ? (left !== null ? `Ходит · ${left} с` : 'Ходит') : p.result === 'LEFT' ? 'Вышел' : ' '}</Text>
            </View>
          );
        })}
      </View>

      <View style={{ flex: 1, paddingHorizontal: 12 }}>
        <Board view={snap.view} seat={snap.seat ?? 0} legal={snap.legal} myTurn={myTurn} onAction={sendAction} disabled={pending || finished} />
      </View>

      <ErrorText>{error}</ErrorText>

      {finished ? (
        <View style={{ padding: 16, gap: 8 }}>
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800', textAlign: 'center' }}>
            {snap.outcome?.winners.length === 0 ? 'Ничья' : mine && snap.outcome?.winners.includes(mine.seat) ? 'Победа! 🎉' : 'Поражение'}
          </Text>
          {snap.outcome && <Text style={{ color: colors.textMuted, textAlign: 'center' }}>Причина: {reasonText(snap.outcome.reason)}</Text>}
          {mine?.ratingDelta != null && (
            <Text style={{ color: mine.ratingDelta >= 0 ? colors.success : colors.danger, textAlign: 'center', fontWeight: '700' }}>
              Рейтинг: {mine.ratingDelta >= 0 ? '+' : ''}{mine.ratingDelta}
            </Text>
          )}
          <Button title="В меню" onPress={() => router.replace('/(tabs)')} />
        </View>
      ) : (
        <View style={{ padding: 12, gap: 8 }}>
          {chat && me.data && <ChatPanel scope="MATCH" target={snap.matchId} myUserId={me.data.id} />}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Button title={chat ? 'Скрыть чат' : 'Чат'} variant="secondary" onPress={() => setChat((v) => !v)} /></View>
            <View style={{ flex: 1 }}><Button title="Сдаться" variant="secondary" onPress={confirmResign} /></View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}
