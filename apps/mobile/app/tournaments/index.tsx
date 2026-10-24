import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { api } from '@/api/client';
import { useTournaments } from '@/api/tournaments';
import { Button, ErrorText, Field } from '@/components/ui';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

const SCOPES = [['open', 'Открытые'], ['mine', 'Мои'], ['finished', 'Завершённые']] as const;
const STATUS = { REGISTRATION: 'набор', IN_PROGRESS: 'идёт', FINISHED: 'завершён', CANCELLED: 'отменён' } as const;

export default function Tournaments() {
  const { colors } = useTheme();
  const router = useRouter();
  const [scope, setScope] = useState<(typeof SCOPES)[number][0]>('open');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { data, isFetching, refetch } = useTournaments(scope);

  const joinByCode = async () => {
    setError(null);
    try {
      const t = await api<{ id: string }>(`/tournaments/code/${code.trim().toUpperCase()}`);
      router.push({ pathname: '/tournament/[id]', params: { id: t.id, code: code.trim().toUpperCase() } });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 20, gap: 10 }}
      data={data ?? []}
      keyExtractor={(t) => t.id}
      refreshing={isFetching}
      onRefresh={refetch}
      ListHeaderComponent={
        <View style={{ gap: 10, marginBottom: 6 }}>
          <Stack.Screen options={{ headerShown: true, title: 'Турниры', headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text }} />
          <Button title="Создать турнир" onPress={() => router.push('/tournament/create')} />
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {SCOPES.map(([k, title]) => <View key={k} style={{ flex: 1 }}><Button title={title} variant={scope === k ? 'primary' : 'secondary'} onPress={() => setScope(k)} /></View>)}
          </View>
          <Field label="Код закрытого турнира" value={code} onChangeText={(t) => setCode(t.toUpperCase())} autoCapitalize="characters" maxLength={6} />
          <ErrorText>{error}</ErrorText>
          {code.length === 6 && <Button title="Найти по коду" variant="secondary" onPress={joinByCode} />}
        </View>
      }
      ListEmptyComponent={<Text style={{ color: colors.textMuted, textAlign: 'center', marginTop: 30 }}>Турниров нет</Text>}
      renderItem={({ item }) => (
        <Pressable onPress={() => router.push({ pathname: '/tournament/[id]', params: { id: item.id } })} style={{ padding: 14, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 3 }}>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17 }}>{item.title}{item.isPrivate ? ' 🔒' : ''}</Text>
          <Text style={{ color: colors.textMuted }}>{item.game.title} · {item.participants}/{item.maxPlayers} · {STATUS[item.status]}</Text>
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>
            {new Date(item.startsAt).toLocaleString('ru-RU')} · взнос {item.entryFee ? `${item.entryFee} 🪙` : 'бесплатно'}
          </Text>
        </Pressable>
      )}
    />
  );
}
