import { Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/useTheme';

/** Заглушка: стол партии появится в реал-тайм слое (шаг 5) и в играх (шаг 6). */
export default function Match() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Stack.Screen options={{ headerShown: true, title: 'Партия', headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text }} />
      <Text style={{ color: colors.text, fontSize: 18 }}>Партия создана</Text>
      <Text style={{ color: colors.textMuted, marginTop: 8 }}>{id}</Text>
    </SafeAreaView>
  );
}
