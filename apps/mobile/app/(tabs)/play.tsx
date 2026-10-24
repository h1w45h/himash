import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useGames } from '@/api/games';
import { Button, Field } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

export default function Play() {
  const { colors } = useTheme();
  const router = useRouter();
  const { data } = useGames();
  const online = (data ?? []).filter((g) => g.supportsOnline);
  const [slug, setSlug] = useState<string>('chess');
  const [code, setCode] = useState('');
  const game = online.find((g) => g.slug === slug);
  const ready = !!game && game.status !== 'PLANNED';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: colors.text, fontSize: 28, fontWeight: '800' }}>Играть</Text>

        <Text style={{ color: colors.text, fontWeight: '700' }}>Игра</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {online.map((g) => (
            <Button key={g.slug} title={g.title} variant={g.slug === slug ? 'primary' : 'secondary'} onPress={() => setSlug(g.slug)} />
          ))}
        </ScrollView>
        {!ready && <Text style={{ color: colors.textMuted }}>Эта игра появится в одном из ближайших обновлений.</Text>}

        <View style={{ gap: 10 }}>
          <Button title="Быстрый поиск соперника" disabled={!ready} onPress={() => router.push({ pathname: '/matchmaking', params: { game: slug } })} />
          <Button title="Создать комнату" variant="secondary" disabled={!ready} onPress={() => router.push({ pathname: '/rooms/create', params: { game: slug } })} />
          <Button title="Открытые комнаты" variant="secondary" onPress={() => router.push('/rooms')} />
          <Button title="🏆 Турниры" variant="secondary" onPress={() => router.push('/tournaments')} />
        </View>

        <View style={{ gap: 10, marginTop: 8 }}>
          <Field label="Войти по коду" value={code} onChangeText={(t) => setCode(t.toUpperCase())} autoCapitalize="characters" maxLength={6} placeholder="ABC123" />
          <Button title="Войти" variant="secondary" disabled={code.length !== 6} onPress={() => router.push(`/room/${code}`)} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
