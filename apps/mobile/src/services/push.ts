import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { api } from '@/api/client';

// Пока приложение открыто, показываем уведомление баннером.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: false, shouldSetBadge: false }),
});

/** Запрашивает разрешение и регистрирует Expo push-токен на сервере. Возвращает false, если нельзя (симулятор, отказ). */
export async function registerForPush(): Promise<boolean> {
  if (!Device.isDevice) return false;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'Основные', importance: Notifications.AndroidImportance.HIGH });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return false;
  const projectId = (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId;
  const { data: pushToken } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  await api('/users/me/devices', { method: 'POST', json: { pushToken, platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID' } });
  return true;
}

/** Регистрация токена после входа + переходы по нажатию на уведомление. */
export function usePushSetup(enabled: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    void registerForPush().catch(() => undefined);
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      const d = resp.notification.request.content.data as Record<string, string | undefined>;
      if (d.matchId) router.push(`/match/${d.matchId}`);
      else if (d.roomCode) router.push(`/room/${d.roomCode}`);
      else if (d.kind === 'dm' && d.userId) router.push(`/chat/${d.userId}`);
      else if (d.type === 'FRIEND_REQUEST' || d.type === 'FRIEND_ACCEPTED') router.push('/(tabs)/friends');
      else router.push('/notifications');
    });
    return () => sub.remove();
  }, [enabled, router]);
}
