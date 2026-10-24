import { useSignIn } from '@clerk/clerk-expo';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { authErrorMessage } from '@/auth/errors';
import { Button, ErrorText, Field } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

export default function SignIn() {
  const { colors } = useTheme();
  const { signIn, setActive, isLoaded } = useSignIn();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!isLoaded) return;
    setLoading(true);
    setError(null);
    try {
      const res = await signIn.create({ identifier: email.trim(), password });
      if (res.status === 'complete') {
        await setActive({ session: res.createdSessionId });
        router.replace('/');
      } else {
        setError('Требуется дополнительное подтверждение. Войдите через другой способ.');
      }
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        <Field label="Пароль" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" />
        <ErrorText>{error}</ErrorText>
        <Button title="Войти" onPress={submit} loading={loading} disabled={!email || !password} />
        <Link href="/(auth)/forgot" style={{ color: colors.primary, textAlign: 'center' }}>Забыли пароль?</Link>
      </ScrollView>
    </SafeAreaView>
  );
}
