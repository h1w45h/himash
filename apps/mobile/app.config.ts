import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Настолки Онлайн',
  slug: 'nastolki-online',
  scheme: 'nastolki',
  version: '0.1.0',
  orientation: 'default',
  userInterfaceStyle: 'automatic', // светлая/тёмная тема следует за системой, пользователь может переопределить
  newArchEnabled: true,
  ios: { bundleIdentifier: 'online.nastolki.app', supportsTablet: true, usesAppleSignIn: true },
  android: { package: 'online.nastolki.app' },
  plugins: ['expo-router', 'expo-secure-store'],
  experiments: { typedRoutes: true },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000',
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
};

export default config;
