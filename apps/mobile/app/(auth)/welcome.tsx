import { useSSO } from '@clerk/clerk-expo';
import { Link, useRouter } from 'expo-router';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DEV_AUTH, useDevStore } from '@/auth/session';
import { authErrorMessage } from '@/auth/errors';
import { Button, ErrorText, Field } from '@/components/ui';
import { ru } from '@/i18n/ru';
import { useTheme } from '@/theme/useTheme';

// Закрывает окно браузера после возврата из OAuth (нужно для Android).
WebBrowser.maybeCompleteAuthSession();

type Strategy = 'oauth_google' | 'oauth_apple' | 'oauth_custom_vk';

function ClerkWelcome() {
  const { colors } = useTheme();
  const router = useRouter();
  const { startSSOFlow } = useSSO();
  const [busy, setBusy] = useState<Strategy | null>(null);
  const [error, setError] = useState<string | null>(null);

  const signInWith = async (strategy: Strategy) => {
    setBusy(strategy);
    setError(null);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: strategy as never, // кастомный провайдер VK настраивается в панели Clerk
        redirectUrl: AuthSession.makeRedirectUri({ scheme: 'nastolki', path: 'sso-callback' }),
      });
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
        router.replace('/');
      }
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, padding: 24, justifyContent: 'space-between' }}>
      <View style={{ marginTop: 80, gap: 8 }}>
        <Text style={{ color: colors.text, fontSize: 36, fontWeight: '800' }}>{ru.appName}</Text>
        <Text style={{ color: colors.textMuted, fontSize: 17 }}>
          Шахматы, Дурак, Монополия и ещё десятки игр — с друзьями и соперниками по всему миру.
        </Text>
      </View>
      <View style={{ gap: 12 }}>
        <ErrorText>{error}</ErrorText>
        <Button title="Войти через Google" variant="secondary" loading={busy === 'oauth_google'} onPress={() => signInWith('oauth_google')} />
        {Platform.OS === 'ios' && (
          <Button title="Войти через Apple" variant="secondary" loading={busy === 'oauth_apple'} onPress={() => signInWith('oauth_apple')} />
        )}
        <Button title="Войти через VK" variant="secondary" loading={busy === 'oauth_custom_vk'} onPress={() => signInWith('oauth_custom_vk')} />
        <Button title="Войти по email" onPress={() => router.push('/(auth)/sign-in')} />
        <Link href="/(auth)/sign-up" style={{ color: colors.primary, textAlign: 'center', padding: 8 }}>
          Нет аккаунта? Зарегистрироваться
        </Link>
      </View>
    </SafeAreaView>
  );
}

/** Локальный вход без Clerk: достаточно придумать ник. Аккаунт создаётся на сервере при первом запросе. */
function DevWelcome() {
  const { colors } = useTheme();
  const router = useRouter();
  const signIn = useDevStore((s) => s.signIn);
  const [nick, setNick] = useState('');
  const valid = /^[A-Za-z0-9_]{3,16}$/.test(nick);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, padding: 24, justifyContent: 'space-between' }}>
      <View style={{ marginTop: 80, gap: 8 }}>
        <Text style={{ color: colors.text, fontSize: 36, fontWeight: '800' }}>{ru.appName}</Text>
        <Text style={{ color: colors.textMuted, fontSize: 17 }}>
          Локальный режим: войдите по нику. Чтобы подключить Google, Apple, VK и email, задайте ключ Clerk (см. docs/AUTH.md).
        </Text>
      </View>
      <View style={{ gap: 12 }}>
        <Field label="Ник (латиница, цифры, _)" value={nick} onChangeText={setNick} autoCapitalize="none" autoCorrect={false} maxLength={16} />
        <Button
          title="Играть"
          disabled={!valid}
          onPress={async () => {
            await signIn(nick);
            router.replace('/');
          }}
        />
      </View>
    </SafeAreaView>
  );
}

export default function Welcome() {
  return DEV_AUTH ? <DevWelcome /> : <ClerkWelcome />;
}
