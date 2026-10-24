import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { useTournamentActions } from '@/api/tournaments';
import { Button, ErrorText, Field } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

const GAMES = [['chess', 'Шахматы'], ['checkers', 'Шашки']] as const;
const SIZES = [4, 8, 16, 32] as const;
const DELAYS = [[10, '10 мин'], [30, '30 мин'], [60, '1 час'], [60 * 24, 'завтра']] as const;

export default function CreateTournament() {
  const { colors } = useTheme();
  const router = useRouter();
  const { create } = useTournamentActions();
  const [title, setTitle] = useState('');
  const [game, setGame] = useState<string>('chess');
  const [size, setSize] = useState<number>(8);
  const [fee, setFee] = useState('0');
  const [priv, setPriv] = useState(false);
  const [delay, setDelay] = useState<number>(30);

  const submit = () =>
    create.mutate(
      { gameSlug: game, title: title.trim(), maxPlayers: size, entryFee: Math.max(0, Number(fee) || 0), isPrivate: priv, startsAt: new Date(Date.now() + delay * 60_000).toISOString() },
      { onSuccess: (t) => router.replace({ pathname: '/tournament/[id]', params: { id: t.id } }) },
    );

  const Chips = <T extends string | number>({ items, value, onPick }: { items: readonly (readonly [T, string])[]; value: T; onPick: (v: T) => void }) => (
    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
      {items.map(([v, label]) => <Button key={String(v)} title={label} variant={value === v ? 'primary' : 'secondary'} onPress={() => onPick(v)} />)}
    </View>
  );

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ headerShown: true, title: 'Новый турнир', headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text }} />
      <Field label="Название" value={title} onChangeText={setTitle} maxLength={60} />
      <Text style={{ color: colors.text, fontWeight: '700' }}>Игра</Text>
      <Chips items={GAMES} value={game} onPick={setGame} />
      <Text style={{ color: colors.text, fontWeight: '700' }}>Участников</Text>
      <Chips items={SIZES.map((n) => [n, String(n)] as const)} value={size} onPick={setSize} />
      <Text style={{ color: colors.text, fontWeight: '700' }}>Старт через</Text>
      <Chips items={DELAYS} value={delay} onPick={setDelay} />
      <Field label="Взнос, монет (0 — бесплатно)" value={fee} onChangeText={(t) => setFee(t.replace(/\D/g, ''))} keyboardType="number-pad" />
      <Text style={{ color: colors.textMuted, fontSize: 12 }}>Взносы формируют призовой фонд: 60% победителю, 25% финалисту, 15% полуфиналистам. В бесплатном турнире призы выдаёт игра.</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: colors.text }}>Закрытый (вход по коду)</Text>
        <Switch value={priv} onValueChange={setPriv} trackColor={{ true: colors.primary }} />
      </View>
      <ErrorText>{create.error?.message}</ErrorText>
      <Button title="Создать" loading={create.isPending} disabled={title.trim().length < 3} onPress={submit} />
    </ScrollView>
  );
}
