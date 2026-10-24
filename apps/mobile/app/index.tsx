import { useAuth } from '@clerk/clerk-expo';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMe } from '@/api/users';
import { Button, ErrorText } from '@/components/ui';
import { ru } from '@/i18n/ru';
import { useTheme } from '@/theme/useTheme';

/** Временная главная: вкладки появятся на этапе «Каталог игр». */
export default function Index() {
  const { colors } = useTheme();
  const { signOut } = useAuth();
  const me = useMe();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, padding: 24, gap: 16, justifyContent: 'center' }}>
      <Text style={{ color: colors.text, fontSize: 28, fontWeight: '700' }}>{ru.appName}</Text>
      {me.isLoading && <ActivityIndicator color={colors.primary} />}
      {me.error && <ErrorText>{me.error.message}</ErrorText>}
      {me.data && (
        <View style={{ gap: 4 }}>
          <Text style={{ color: colors.text, fontSize: 20 }}>Привет, {me.data.displayName}!</Text>
          <Text style={{ color: colors.textMuted }}>@{me.data.username} · 🪙 {me.data.wallet?.coins ?? 0}</Text>
        </View>
      )}
      <Button title="Выйти" variant="secondary" onPress={() => signOut()} />
    </SafeAreaView>
  );
}
