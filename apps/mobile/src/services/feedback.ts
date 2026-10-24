import * as Haptics from 'expo-haptics';
import { useSettings } from '@/stores/settings';

/**
 * Тактильная отдача с учётом настроек. Звуки подключаются здесь же (expo-av + ассеты),
 * когда будут готовы аудиофайлы — вызывающий код менять не придётся.
 */
const enabled = () => useSettings.getState().haptics;

export const feedback = {
  tap: () => enabled() && void Haptics.selectionAsync().catch(() => undefined),
  move: () => enabled() && void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined),
  win: () => enabled() && void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined),
  lose: () => enabled() && void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined),
};
