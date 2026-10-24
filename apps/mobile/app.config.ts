import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Настолки Онлайн',
  slug: 'nastolki-online',
  scheme: 'nastolki',
  version: '0.1.0',
  orientation: 'default',
  icon: './assets/icon.png',
  splash: { image: './assets/splash-icon.png', resizeMode: 'contain', backgroundColor: '#C2410C' },
  userInterfaceStyle: 'automatic', // светлая/тёмная тема следует за системой, пользователь может переопределить
  newArchEnabled: true,
  ios: {
    bundleIdentifier: 'online.nastolki.app',
    supportsTablet: true,
    usesAppleSignIn: true,
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    package: 'online.nastolki.app',
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#C2410C' },
    permissions: ['VIBRATE', 'POST_NOTIFICATIONS'],
  },
  web: { favicon: './assets/favicon.png' },
  plugins: ['expo-router', 'expo-secure-store', ['expo-notifications', { color: '#C2410C' }]],
  experiments: { typedRoutes: true },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000',
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
};

export default config;
