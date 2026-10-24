import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { useFriendActions, useFriends, usePublicProfile } from '@/api/social';
import { useMe } from '@/api/users';
import { Avatar } from '@/components/Avatar';
import { Button, ErrorText } from '@/components/ui';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

export default function UserProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const me = useMe();
  const { data: p } = usePublicProfile(id);
  const friends = useFriends();
  const actions = useFriendActions();
  if (!p) return null;
  const self = me.data?.id === p.id;
  const isFriend = friends.data?.friends.some((f) => f.user.id === p.id);
  const pending = [...(friends.data?.outgoing ?? []), ...(friends.data?.incoming ?? [])].some((f) => f.user.id === p.id);

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} style={{ backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerShown: true, title: p.displayName, headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text }} />
      <View style={{ alignItems: 'center', gap: 6 }}>
        <Avatar name={p.displayName} url={p.avatarUrl} avatarId={p.avatarId} size={88} />
        <Text style={{ color: colors.text, fontSize: 24, fontWeight: '800' }}>{p.displayName}</Text>
        <Text style={{ color: colors.textMuted }}>@{p.username}</Text>
        {p.bio && <Text style={{ color: colors.text, textAlign: 'center' }}>{p.bio}</Text>}
      </View>
      {!self && (
        <View style={{ gap: 8 }}>
          <ErrorText>{(actions.request.error ?? actions.block.error)?.message}</ErrorText>
          {isFriend ? (
            <>
              <Button title="Написать" onPress={() => router.push(`/chat/${p.id}`)} />
              <Button title="Удалить из друзей" variant="secondary" onPress={() => actions.remove.mutate(p.id)} />
            </>
          ) : (
            <Button title={pending ? 'Заявка отправлена' : 'Добавить в друзья'} disabled={pending} loading={actions.request.isPending} onPress={() => actions.request.mutate({ userId: p.id })} />
          )}
          <Button title="Заблокировать" variant="secondary" onPress={() => actions.block.mutate(p.id, { onSuccess: () => router.back() })} />
        </View>
      )}
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>Рейтинги</Text>
      {p.ratings.length === 0 && <Text style={{ color: colors.textMuted }}>Пока нет рейтинговых партий</Text>}
      {p.ratings.map((r) => (
        <View key={r.game.slug} style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 12, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
          <Text style={{ color: colors.text, fontWeight: '600' }}>{r.game.title}</Text>
          <Text style={{ color: colors.text }}>{r.rating}  <Text style={{ color: colors.textMuted }}>({r.wins}–{r.losses}–{r.draws})</Text></Text>
        </View>
      ))}
    </ScrollView>
  );
}
