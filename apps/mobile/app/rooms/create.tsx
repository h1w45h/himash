import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { useGame } from '@/api/games';
import { useRoomActions } from '@/api/rooms';
import { Button, ErrorText, Field } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

type Visibility = 'PUBLIC' | 'PRIVATE' | 'FRIENDS';
const VIS: { v: Visibility; title: string }[] = [
  { v: 'PUBLIC', title: 'Открытая' },
  { v: 'FRIENDS', title: 'Друзья' },
  { v: 'PRIVATE', title: 'По коду' },
];

export default function CreateRoom() {
  const { game: slug } = useLocalSearchParams<{ game: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const { data: game } = useGame(slug);
  const { create } = useRoomActions();
  const [players, setPlayers] = useState<number | null>(null);
  const [visibility, setVisibility] = useState<Visibility>('PUBLIC');
  const [variant, setVariant] = useState<string | undefined>();
  const [password, setPassword] = useState('');
  const [rated, setRated] = useState(true);

  if (!game) return null;
  const count = players ?? game.minPlayers;

  const submit = () =>
    create.mutate(
      { gameSlug: slug, maxPlayers: count, visibility, variantKey: variant, password: password || undefined, isRated: rated && game.isRated },
      { onSuccess: (room) => router.replace(`/room/${room.code}`) },
    );

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} style={{ backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerShown: true, title: `Комната: ${game.title}`, headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text }} />
      <Text style={{ color: colors.text, fontWeight: '700' }}>Число игроков: {count}</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title="−" variant="secondary" disabled={count <= game.minPlayers} onPress={() => setPlayers(count - 1)} />
        <Button title="+" variant="secondary" disabled={count >= game.maxPlayers} onPress={() => setPlayers(count + 1)} />
      </View>
      {game.variants && (
        <>
          <Text style={{ color: colors.text, fontWeight: '700' }}>Вариант</Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {game.variants.map((v) => (
              <Button key={v.key} title={v.title} variant={variant === v.key ? 'primary' : 'secondary'} onPress={() => setVariant(v.key)} />
            ))}
          </View>
        </>
      )}
      <Text style={{ color: colors.text, fontWeight: '700' }}>Кто может войти</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {VIS.map((o) => (
          <View key={o.v} style={{ flex: 1 }}>
            <Button title={o.title} variant={visibility === o.v ? 'primary' : 'secondary'} onPress={() => setVisibility(o.v)} />
          </View>
        ))}
      </View>
      <Field label="Пароль (необязательно)" value={password} onChangeText={setPassword} secureTextEntry />
      {game.isRated && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: colors.text }}>Рейтинговая партия</Text>
          <Switch value={rated} onValueChange={setRated} />
        </View>
      )}
      <ErrorText>{create.error?.message}</ErrorText>
      <Button title="Создать комнату" onPress={submit} loading={create.isPending} />
    </ScrollView>
  );
}
