import { Stack } from 'expo-router';
import { FlatList, Text, View } from 'react-native';
import { useAchievements } from '@/api/economy';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

const RARITY_COLOR = { COMMON: '#8A8F98', RARE: '#2F6FED', EPIC: '#8E4EC6', LEGENDARY: '#F2A413' } as const;

export default function Achievements() {
  const { colors } = useTheme();
  const { data } = useAchievements();
  const done = data?.filter((a) => a.unlockedAt).length ?? 0;
  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 20, gap: 10 }}
      data={data ?? []}
      keyExtractor={(a) => a.key}
      ListHeaderComponent={
        <>
          <Stack.Screen options={{ headerShown: true, title: 'Достижения', headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text }} />
          <Text style={{ color: colors.textMuted, marginBottom: 6 }}>Получено {done} из {data?.length ?? 0}</Text>
        </>
      }
      renderItem={({ item }) => {
        const pct = Math.min(1, item.progress / item.target);
        const unlocked = !!item.unlockedAt;
        return (
          <View style={{ padding: 12, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 2, borderColor: unlocked ? RARITY_COLOR[item.rarity] : colors.border, opacity: unlocked ? 1 : 0.85, gap: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: colors.text, fontWeight: '800', flex: 1 }}>{unlocked ? '🏆 ' : '🔒 '}{item.title}</Text>
              <Text style={{ color: colors.textMuted }}>+{item.reward} 🪙</Text>
            </View>
            <Text style={{ color: colors.textMuted }}>{item.description}</Text>
            {!unlocked && (
              <View style={{ gap: 2 }}>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: 'hidden' }}>
                  <View style={{ width: `${pct * 100}%`, height: 6, backgroundColor: RARITY_COLOR[item.rarity] }} />
                </View>
                <Text style={{ color: colors.textMuted, fontSize: 11 }}>{item.progress} / {item.target}</Text>
              </View>
            )}
          </View>
        );
      }}
    />
  );
}
