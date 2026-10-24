import { useAuth as useClerkAuth } from '@clerk/clerk-expo';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

/**
 * Режим авторизации выбирается при сборке: есть EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY — Clerk,
 * нет — локальный вход по нику (для разработки и демонстрации; сервер принимает токен `dev:<ник>`).
 */
export const DEV_AUTH = !process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

const KEY = 'dev_nick';

interface DevStore {
  loaded: boolean;
  nick: string | null;
  signIn: (nick: string) => Promise<void>;
  signOut: () => Promise<void>;
  load: () => Promise<void>;
}

export const useDevStore = create<DevStore>((set) => ({
  loaded: false,
  nick: null,
  signIn: async (nick) => {
    await SecureStore.setItemAsync(KEY, nick).catch(() => undefined);
    set({ nick });
  },
  signOut: async () => {
    await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
    set({ nick: null });
  },
  load: async () => {
    const nick = await SecureStore.getItemAsync(KEY).catch(() => null);
    set({ nick, loaded: true });
  },
}));

function useDevAuth() {
  const { loaded, nick, signOut } = useDevStore();
  return {
    isLoaded: loaded,
    isSignedIn: !!nick,
    getToken: async () => (nick ? `dev:${nick}` : null),
    signOut,
  };
}

/** Единый хук сессии для обоих режимов (режим не меняется во время работы, поэтому порядок хуков стабилен). */
export const useAuth: () => {
  isLoaded: boolean;
  isSignedIn: boolean | undefined;
  getToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
} = DEV_AUTH ? useDevAuth : (useClerkAuth as never);
