import { useAuth } from '@/auth/session';
import { useRouter } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { Alert, AppState } from 'react-native';
import { usePushSetup } from '@/services/push';
import { connectSocket, disconnectSocket, useSocketStore } from './socket';
import { usePresence } from './usePresence';

/** Держит соединение, пока пользователь авторизован; при возврате из фона проверяет его. */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { isSignedIn, getToken } = useAuth();
  usePresence();
  const router = useRouter();
  usePushSetup(!!isSignedIn);

  useEffect(() => {
    if (!isSignedIn) {
      disconnectSocket();
      return;
    }
    const socket = connectSocket(() => getToken());
    const sub = AppState.addEventListener('change', (state) => {
      // iOS/Android могут тихо закрыть сокет в фоне — при возврате переподключаемся сразу.
      if (state === 'active' && !socket.connected) socket.connect();
    });
    return () => sub.remove();
  }, [isSignedIn, getToken]);

  // Партия турнира готова — предлагаем сразу перейти к игре (первый ход нужно сделать вовремя).
  const socket = useSocketStore((st) => st.socket);
  useEffect(() => {
    if (!socket) return;
    const onMatch = (d: { matchId: string }) =>
      Alert.alert('Турнир', 'Ваша партия готова! Первый ход нужно сделать в течение 2 минут.', [
        { text: 'Позже', style: 'cancel' },
        { text: 'Играть', onPress: () => router.push(`/match/${d.matchId}`) },
      ]);
    socket.on('tournament:match', onMatch);
    return () => {
      socket.off('tournament:match', onMatch);
    };
  }, [socket, router]);

  return <>{children}</>;
}
