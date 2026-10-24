import { ClerkProvider, useAuth } from '@clerk/clerk-expo';
import { tokenCache } from '@clerk/clerk-expo/token-cache';
import { useEffect, type ReactNode } from 'react';
import { setTokenGetter } from '@/api/client';

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

function TokenBridge({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();
  useEffect(() => setTokenGetter(() => getToken()), [getToken]);
  return <>{children}</>;
}

/** Токены Clerk хранятся в SecureStore (Keychain / Keystore). */
export function AuthProvider({ children }: { children: ReactNode }) {
  if (!publishableKey) throw new Error('Не задан EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY');
  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <TokenBridge>{children}</TokenBridge>
    </ClerkProvider>
  );
}
