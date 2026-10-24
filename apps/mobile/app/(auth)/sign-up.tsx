import { useSignUp } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { authErrorMessage } from '@/auth/errors';
import { Button, ErrorText, Field } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

export default function SignUp() {
  const { colors } = useTheme();
  const { signUp, setActive, isLoaded } = useSignUp();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false); // ждём код из письма
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

  const start = () =>
    run(async () => {
      if (!isLoaded) return;
      await signUp.create({ emailAddress: email.trim(), password });
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setPending(true);
    });

  const verify = () =>
    run(async () => {
      if (!isLoaded) return;
      const res = await signUp.attemptEmailAddressVerification({ code: code.trim() });
      if (res.status === 'complete') {
        await setActive({ session: res.createdSessionId });
        router.replace('/');
      } else {
        setError('Не удалось завершить регистрацию. Попробуйте ещё раз.');
      }
    });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }} keyboardShouldPersistTaps="handled">
        {!pending ? (
          <>
            <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
            <Field label="Пароль (минимум 8 символов)" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
            <ErrorText>{error}</ErrorText>
            <Button title="Создать аккаунт" onPress={start} loading={loading} disabled={!email || password.length < 8} />
          </>
        ) : (
          <>
            <Field label="Код из письма" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" />
            <ErrorText>{error}</ErrorText>
            <Button title="Подтвердить" onPress={verify} loading={loading} disabled={code.length < 6} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
