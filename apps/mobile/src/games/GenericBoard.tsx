import { ScrollView, Text, View } from 'react-native';
import { Button } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';
import type { GameUIProps } from './registry';

/** Запасной интерфейс: показывает состояние и допустимые действия списком. Для отладки движков. */
export function GenericBoard({ view, legal, myTurn, onAction, disabled }: GameUIProps) {
  const { colors } = useTheme();
  return (
    <ScrollView contentContainerStyle={{ gap: 12 }}>
      <View style={{ backgroundColor: colors.surface, padding: 12, borderRadius: 12 }}>
        <Text style={{ color: colors.text, fontFamily: 'Courier' }}>{JSON.stringify(view, null, 2)}</Text>
      </View>
      {myTurn && legal.slice(0, 30).map((a, i) => (
        <Button key={i} title={JSON.stringify(a)} variant="secondary" disabled={disabled} onPress={() => onAction(a)} />
      ))}
    </ScrollView>
  );
}
