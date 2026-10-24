import { ClerkProvider } from '@clerk/clerk-expo';
import { tokenCache } from '@clerk/clerk-expo/token-cache';
import { useEffect, type ReactNode } from 'react';
import { setTokenGetter } from '@/api/client';
import { DEV_AUTH, useAuth, useDevStore } from './session';

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

function TokenBridge({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();
  useEffect(() => setTokenGetter(() => getToken()), [getToken]);
  return <>{children}</>;
}

/** Токены Clerk хранятся в SecureStore (Keychain / Keystore); без ключа Clerk работает локальный вход по нику. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const load = useDevStore((s) => s.load);
  useEffect(() => {
    if (DEV_AUTH) void load();
  }, [load]);
  if (DEV_AUTH) return <TokenBridge>{children}</TokenBridge>;
  return (
    <ClerkProvider publishableKey={publishableKey!} tokenCache={tokenCache}>
      <TokenBridge>{children}</TokenBridge>
    </ClerkProvider>
  );
}
