import { Text, View } from 'react-native';
import { ru } from '@/i18n/ru';
import { useTheme } from '@/theme/useTheme';

export default function Index() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
      <Text style={{ color: colors.text, fontSize: 28, fontWeight: '700' }}>{ru.appName}</Text>
    </View>
  );
}
