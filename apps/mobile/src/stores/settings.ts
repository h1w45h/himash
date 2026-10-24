import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { MMKV } from 'react-native-mmkv';

const mmkv = new MMKV({ id: 'settings' });
const storage: StateStorage = {
  getItem: (k) => mmkv.getString(k) ?? null,
  setItem: (k, v) => mmkv.set(k, v),
  removeItem: (k) => mmkv.delete(k),
};

export type ThemeMode = 'system' | 'light' | 'dark';

interface SettingsState {
  theme: ThemeMode;
  sound: boolean;
  haptics: boolean;
  /** Экипированное оформление (assetKey). Хранится локально, чтобы работать оффлайн и без мигания при запуске. */
  boardTheme: string | null;
  cardBack: string | null;
  appTheme: string | null;
  set: (patch: Partial<Omit<SettingsState, 'set'>>) => void;
}

/** Настройки хранятся локально (MMKV) — работают без сети и применяются мгновенно. */
export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'system',
      sound: true,
      haptics: true,
      boardTheme: null,
      cardBack: null,
      appTheme: null,
      set: (patch) => set(patch),
    }),
    { name: 'settings', storage: createJSONStorage(() => storage) },
  ),
);
