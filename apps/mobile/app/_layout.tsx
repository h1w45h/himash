import 'react-native-gesture-handler';
import { useAuth } from '@clerk/clerk-expo';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider } from '@/auth/AuthProvider';
import { useTheme } from '@/theme/useTheme';

/** Перенаправляет неавторизованных в (auth), авторизованных — из (auth) в приложение. */
function AuthGate() {
  const { isLoaded, isSignedIn } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!isLoaded) return;
    const inAuth = segments[0] === '(auth)';
    if (!isSignedIn && !inAuth) router.replace('/(auth)/welcome');
    else if (isSignedIn && inAuth) router.replace('/');
  }, [isLoaded, isSignedIn, segments, router]);

  return <Slot />;
}

export default function RootLayout() {
  const { isDark } = useTheme();
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style={isDark ? 'light' : 'dark'} />
          <AuthGate />
        </QueryClientProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
