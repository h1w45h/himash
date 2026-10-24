import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { matchmaking } from '@/api/rooms';
import { useSocketStore } from '@/realtime/socket';
import { Button, ErrorText } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

export default function Matchmaking() {
  const { game, variant } = useLocalSearchParams<{ game: string; variant?: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const [waited, setWaited] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);
  const socket = useSocketStore((st) => st.socket);

  // Сокет сообщает о найденной партии мгновенно; опрос ниже — запасной путь.
  useEffect(() => {
    if (!socket) return;
    const onFound = (f: { matchId: string }) => {
      done.current = true;
      router.replace(`/match/${f.matchId}`);
    };
    socket.on('mm:found', onFound);
    return () => {
      socket.off('mm:found', onFound);
    };
  }, [socket, router]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const s = await matchmaking.status();
        if (cancelled) return;
        if (s.state === 'found') {
          done.current = true;
          router.replace(`/match/${s.matchId}`);
          return;
        }
        if (s.state === 'searching') setWaited(Math.floor(s.waitedMs / 1000));
        if (s.state === 'idle') {
          setError('Поиск прерван. Попробуйте снова.');
          return;
        }
      } catch {
        // единичный сбой сети не должен ронять поиск — просто пробуем ещё раз
      }
      timer = setTimeout(poll, 1500);
    };

    matchmaking
      .join(game, variant)
      .then(() => {
        if (!cancelled) void poll();
      })
      .catch((e: Error) => !cancelled && setError(e.message));

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (!done.current) void matchmaking.leave().catch(() => {}); // уходим с экрана — выходим из очереди
    };
  }, [game, variant, router]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }}>
      <Stack.Screen options={{ headerShown: true, title: 'Поиск соперника', headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text }} />
      {error ? (
        <ErrorText>{error}</ErrorText>
      ) : (
        <>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}>Ищем соперника…</Text>
          <Text style={{ color: colors.textMuted }}>Ожидание: {waited} с. Диапазон рейтинга расширяется.</Text>
        </>
      )}
      <View style={{ alignSelf: 'stretch' }}>
        <Button title="Отмена" variant="secondary" onPress={() => router.back()} />
      </View>
    </SafeAreaView>
  );
}
