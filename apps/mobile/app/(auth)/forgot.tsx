import { useSignIn } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { authErrorMessage } from '@/auth/errors';
import { Button, ErrorText, Field } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

export default function Forgot() {
  const { colors } = useTheme();
  const { signIn, setActive, isLoaded } = useSignIn();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setLoading(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const sendCode = () =>
    run(async () => {
      if (!isLoaded) return;
      await signIn.create({ strategy: 'reset_password_email_code', identifier: email.trim() });
      setSent(true);
    });

  const reset = () =>
    run(async () => {
      if (!isLoaded) return;
      const res = await signIn.attemptFirstFactor({ strategy: 'reset_password_email_code', code: code.trim(), password });
      if (res.status === 'complete') {
        await setActive({ session: res.createdSessionId });
        router.replace('/');
      }
    });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }} keyboardShouldPersistTaps="handled">
        {!sent ? (
          <>
            <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
            <ErrorText>{error}</ErrorText>
            <Button title="Отправить код" onPress={sendCode} loading={loading} disabled={!email} />
          </>
        ) : (
          <>
            <Field label="Код из письма" value={code} onChangeText={setCode} keyboardType="number-pad" />
            <Field label="Новый пароль" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
            <ErrorText>{error}</ErrorText>
            <Button title="Сменить пароль" onPress={reset} loading={loading} disabled={code.length < 6 || password.length < 8} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
