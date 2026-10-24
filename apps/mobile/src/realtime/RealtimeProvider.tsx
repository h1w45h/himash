import { useAuth } from '@clerk/clerk-expo';
import { useEffect, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { usePushSetup } from '@/services/push';
import { connectSocket, disconnectSocket } from './socket';
import { usePresence } from './usePresence';

/** Держит соединение, пока пользователь авторизован; при возврате из фона проверяет его. */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { isSignedIn, getToken } = useAuth();
  usePresence();
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

  return <>{children}</>;
}
