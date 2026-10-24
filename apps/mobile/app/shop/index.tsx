import { Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useShop, useShopActions, useWallet, type ShopItem } from '@/api/economy';
import { Button, ErrorText } from '@/components/ui';
import { AVATAR_EMOJI, BOARD_THEMES, CARD_BACKS, APP_THEMES } from '@/theme/cosmetics';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

const TABS: { type: ShopItem['type']; title: string }[] = [
  { type: 'AVATAR', title: 'Аватары' },
  { type: 'BOARD_THEME', title: 'Доски' },
  { type: 'CARD_BACK', title: 'Рубашки' },
  { type: 'APP_THEME', title: 'Темы' },
];
const RARITY: Record<ShopItem['rarity'], string> = { COMMON: '#8A8F98', RARE: '#2F6FED', EPIC: '#8E4EC6', LEGENDARY: '#F2A413' };

function Preview({ item }: { item: ShopItem }) {
  const box = { width: 64, height: 64, borderRadius: 14, alignItems: 'center' as const, justifyContent: 'center' as const, overflow: 'hidden' as const };
  if (item.type === 'AVATAR') return <View style={[box, { backgroundColor: '#E9E4D4' }]}><Text style={{ fontSize: 34 }}>{AVATAR_EMOJI[item.assetKey] ?? '🙂'}</Text></View>;
  if (item.type === 'BOARD_THEME') {
    const t = BOARD_THEMES[item.assetKey];
    return (
      <View style={[box, { flexDirection: 'row', flexWrap: 'wrap' }]}>
        {[0, 1, 2, 3].map((i) => <View key={i} style={{ width: 32, height: 32, backgroundColor: (i + Math.floor(i / 2)) % 2 ? t?.dark : t?.light }} />)}
      </View>
    );
  }
  if (item.type === 'CARD_BACK') return <View style={[box, { width: 46, backgroundColor: CARD_BACKS[item.assetKey], borderWidth: 3, borderColor: '#fff' }]} />;
  return <View style={[box, { backgroundColor: APP_THEMES[item.assetKey]?.primary }]} />;
}

export default function Shop() {
  const { colors } = useTheme();
  const { data: items } = useShop();
  const wallet = useWallet();
  const actions = useShopActions();
  const [tab, setTab] = useState<ShopItem['type']>('AVATAR');
  const error = actions.buy.error ?? actions.equip.error ?? actions.daily.error;
  const d = wallet.data?.daily;

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Stack.Screen options={{ headerShown: true, title: 'Магазин', headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800' }}>🪙 {wallet.data?.coins ?? '…'}</Text>
        {d && (d.available ? (
          <Button title={`Бонус дня: +${d.nextBonus}`} loading={actions.daily.isPending} onPress={() => actions.daily.mutate()} />
        ) : (
          <Text style={{ color: colors.textMuted }}>Бонус получен · серия {d.streak} дн.</Text>
        ))}
      </View>

      <View style={{ flexDirection: 'row', gap: 6 }}>
        {TABS.map((t) => (
          <View key={t.type} style={{ flex: 1 }}><Button title={t.title} variant={tab === t.type ? 'primary' : 'secondary'} onPress={() => setTab(t.type)} /></View>
        ))}
      </View>
      <ErrorText>{error?.message}</ErrorText>

      {items?.filter((i) => i.type === tab).map((item) => (
        <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 2, borderColor: item.equipped ? colors.primary : colors.border }}>
          <Preview item={item} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>{item.title}</Text>
            <Text style={{ color: RARITY[item.rarity], fontSize: 12, fontWeight: '700' }}>{{ COMMON: 'Обычный', RARE: 'Редкий', EPIC: 'Эпический', LEGENDARY: 'Легендарный' }[item.rarity]}</Text>
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>{item.description}</Text>
          </View>
          {item.equipped ? (
            <Button title="Снять" variant="secondary" onPress={() => actions.unequip.mutate(item.type)} />
          ) : item.owned ? (
            <Button title="Применить" onPress={() => actions.equip.mutate(item.id)} />
          ) : (
            <Button title={`🪙 ${item.price}`} disabled={(wallet.data?.coins ?? 0) < item.price} loading={actions.buy.isPending && actions.buy.variables === item.id} onPress={() => actions.buy.mutate(item.id)} />
          )}
        </View>
      ))}
      <Text style={{ color: colors.textMuted, fontSize: 12, textAlign: 'center' }}>Монеты можно получить за партии, достижения и ежедневный бонус.</Text>
    </ScrollView>
  );
}
