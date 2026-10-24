import { useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useGames } from '@/api/games';
import { useMe } from '@/api/users';
import { useShopActions, useWallet } from '@/api/economy';
import { useActiveMatch, useInvitations, useNotifications } from '@/api/social';
import { api } from '@/api/client';
import { Button } from '@/components/ui';
import { GameCard } from '@/components/GameCard';
import { useTheme } from '@/theme/useTheme';

export default function Home() {
  const { colors } = useTheme();
  const router = useRouter();
  const me = useMe();
  const games = useGames();
  const active = useActiveMatch();
  const invites = useInvitations();
  const notes = useNotifications();
  const wallet = useWallet();
  const shop = useShopActions();
  const popular = games.data?.filter((g) => ['chess', 'durak', 'monopoly'].includes(g.slug)) ?? [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <View>
          <Text style={{ color: colors.text, fontSize: 26, fontWeight: '800' }}>
            {me.data ? `Привет, ${me.data.displayName}!` : 'Добро пожаловать!'}
          </Text>
          {me.data && <Text style={{ color: colors.textMuted }}>🪙 {me.data.wallet?.coins ?? 0}</Text>}
          {me.isLoading && <ActivityIndicator color={colors.primary} />}
        </View>
        {wallet.data?.daily.available && (
          <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 14, gap: 8, borderWidth: 1, borderColor: colors.primary }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>🎁 Ежедневный бонус: +{wallet.data.daily.nextBonus} монет{wallet.data.daily.streak ? ` (серия ${wallet.data.daily.streak} дн.)` : ''}</Text>
            <Button title="Забрать" loading={shop.daily.isPending} onPress={() => shop.daily.mutate()} />
          </View>
        )}
        {active.data && (
          <View style={{ backgroundColor: colors.primary, borderRadius: 16, padding: 14, gap: 8 }}>
            <Text style={{ color: colors.onPrimary, fontWeight: '800', fontSize: 16 }}>Партия в процессе: {active.data.game.title}</Text>
            <Button title="Продолжить" variant="secondary" onPress={() => router.push(`/match/${active.data!.id}`)} />
          </View>
        )}
        {invites.data?.map((inv) => (
          <View key={inv.id} style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 14, gap: 8, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>{inv.sender.displayName} зовёт в «{inv.room.game.title}»</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}><Button title="Принять" onPress={() => api(`/invitations/${inv.id}/accept`, { method: 'POST' }).then(() => router.push(`/room/${inv.room.code}`)).catch(() => invites.refetch())} /></View>
              <View style={{ flex: 1 }}><Button title="Отклонить" variant="secondary" onPress={() => api(`/invitations/${inv.id}/decline`, { method: 'POST' }).finally(() => invites.refetch())} /></View>
            </View>
          </View>
        ))}
        {(notes.data?.unread ?? 0) > 0 && (
          <Text onPress={() => router.push('/notifications')} style={{ color: colors.primary, fontWeight: '700' }}>🔔 Новых уведомлений: {notes.data?.unread}</Text>
        )}
        <Text style={{ color: colors.text, fontSize: 19, fontWeight: '700' }}>Популярное</Text>
        {popular.map((g) => (
          <GameCard key={g.slug} game={g} onPress={() => router.push(`/game/${g.slug}`)} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
