import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/useTheme';

/** Заглушка: экран появится на одном из следующих этапов. */
export default function Screen() {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: colors.textMuted, fontSize: 16 }}>Играть — скоро</Text>
    </SafeAreaView>
  );
}
