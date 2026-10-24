import { useAuth } from '@clerk/clerk-expo';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMe } from '@/api/users';
import { Button } from '@/components/ui';
import { useSettings, type ThemeMode } from '@/stores/settings';
import { useTheme } from '@/theme/useTheme';

const THEMES: { mode: ThemeMode; title: string }[] = [
  { mode: 'system', title: 'Системная' },
  { mode: 'light', title: 'Светлая' },
  { mode: 'dark', title: 'Тёмная' },
];

/** Временный профиль: тема и выход. Полный профиль (рейтинг, история) — на этапе «Рейтинг и профиль». */
export default function Profile() {
  const { colors } = useTheme();
  const { signOut } = useAuth();
  const me = useMe();
  const theme = useSettings((s) => s.theme);
  const set = useSettings((s) => s.set);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, padding: 20, gap: 16 }}>
      <Text style={{ color: colors.text, fontSize: 28, fontWeight: '800' }}>{me.data?.displayName ?? 'Профиль'}</Text>
      {me.data && <Text style={{ color: colors.textMuted }}>@{me.data.username}</Text>}
      <Text style={{ color: colors.text, fontWeight: '700', marginTop: 8 }}>Тема</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {THEMES.map((t) => (
          <View key={t.mode} style={{ flex: 1 }}>
            <Button title={t.title} variant={theme === t.mode ? 'primary' : 'secondary'} onPress={() => set({ theme: t.mode })} />
          </View>
        ))}
      </View>
      <View style={{ marginTop: 24 }}>
        <Button title="Выйти" variant="secondary" onPress={() => signOut()} />
      </View>
    </SafeAreaView>
  );
}
