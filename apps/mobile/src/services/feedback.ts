import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useSettings } from '@/stores/settings';

/**
 * Обратная связь: вибрация (expo-haptics) и звуки (expo-av) с учётом настроек.
 * Звуки синтезируются скриптом `scripts/make-sounds.mjs` и лежат в `assets/sounds`.
 */
const haptics = () => useSettings.getState().haptics;
const soundOn = () => useSettings.getState().sound;

const FILES = {
  tap: require('../../assets/sounds/tap.wav'),
  move: require('../../assets/sounds/move.wav'),
  win: require('../../assets/sounds/win.wav'),
  lose: require('../../assets/sounds/lose.wav'),
  notify: require('../../assets/sounds/notify.wav'),
  dice: require('../../assets/sounds/dice.wav'),
  card: require('../../assets/sounds/card.wav'),
} as const;
type SoundName = keyof typeof FILES;

const cache = new Map<SoundName, Audio.Sound>();
let modeSet = false;

/** Проигрывает звук; ошибки (нет аудио-устройства, ограничения платформы) не должны ломать игру. */
async function play(name: SoundName) {
  if (!soundOn()) return;
  try {
    if (!modeSet) {
      modeSet = true;
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: false, shouldDuckAndroid: true });
    }
    let sound = cache.get(name);
    if (!sound) {
      const created = await Audio.Sound.createAsync(FILES[name], { volume: 0.7 });
      sound = created.sound;
      cache.set(name, sound);
    }
    await sound.setPositionAsync(0);
    await sound.playAsync();
  } catch {
    // звук необязателен
  }
}

export const feedback = {
  tap: () => {
    if (haptics()) void Haptics.selectionAsync().catch(() => undefined);
    void play('tap');
  },
  move: () => {
    if (haptics()) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    void play('move');
  },
  win: () => {
    if (haptics()) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    void play('win');
  },
  lose: () => {
    if (haptics()) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
    void play('lose');
  },
  /** Входящее приглашение, ваш ход и т.п. */
  notify: () => void play('notify'),
  dice: () => void play('dice'),
  card: () => void play('card'),
};
