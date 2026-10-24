import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { inviteToRoom, useMyRoom } from '@/api/rooms';
import { useFriendActions, useFriends, useUserSearch } from '@/api/social';
import { Avatar } from '@/components/Avatar';
import { Button, ErrorText } from '@/components/ui';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

const STATUS_TEXT = { online: 'в сети', playing: 'в игре', offline: 'не в сети' } as const;

export default function Friends() {
  const { colors } = useTheme();
  const router = useRouter();
  const { data } = useFriends();
  const actions = useFriendActions();
  const myRoom = useMyRoom();
  const [q, setQ] = useState('');
  const search = useUserSearch(q);
  const friendIds = new Set(data?.friends.map((f) => f.user.id));
  const pendingIds = new Set([...(data?.outgoing ?? []), ...(data?.incoming ?? [])].map((f) => f.user.id));

  const Row = ({ children }: { children: React.ReactNode }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>{children}</View>
  );
  const error = actions.request.error ?? actions.accept.error ?? actions.remove.error;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: colors.text, fontSize: 28, fontWeight: '800' }}>Друзья</Text>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Найти игрока по нику"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          style={{ height: 46, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: 14, fontSize: 16 }}
        />
        <ErrorText>{error?.message}</ErrorText>

        {q.trim().length >= 2 && (
          <View style={{ gap: 8 }}>
            {search.data?.length === 0 && <Text style={{ color: colors.textMuted }}>Никого не найдено</Text>}
            {search.data?.map((u) => (
              <Row key={u.id}>
                <Avatar name={u.displayName} url={u.avatarUrl} avatarId={u.avatarId} />
                <Text onPress={() => router.push(`/user/${u.id}`)} style={{ flex: 1, color: colors.text, fontWeight: '600' }}>{u.displayName} <Text style={{ color: colors.textMuted }}>@{u.username}</Text></Text>
                {friendIds.has(u.id) ? <Text style={{ color: colors.textMuted }}>друг</Text> : pendingIds.has(u.id) ? <Text style={{ color: colors.textMuted }}>заявка</Text> : (
                  <Button title="Добавить" variant="secondary" onPress={() => actions.request.mutate({ userId: u.id })} />
                )}
              </Row>
            ))}
          </View>
        )}

        {(data?.incoming.length ?? 0) > 0 && (
          <View style={{ gap: 8 }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>Заявки</Text>
            {data?.incoming.map((r) => (
              <Row key={r.friendshipId}>
                <Avatar name={r.user.displayName} url={r.user.avatarUrl} avatarId={r.user.avatarId} />
                <Text style={{ flex: 1, color: colors.text }}>{r.user.displayName}</Text>
                <Button title="Принять" onPress={() => actions.accept.mutate(r.friendshipId)} />
                <Button title="✕" variant="secondary" onPress={() => actions.decline.mutate(r.friendshipId)} />
              </Row>
            ))}
          </View>
        )}

        <Text style={{ color: colors.text, fontWeight: '700' }}>Мои друзья · {data?.friends.length ?? 0}</Text>
        {data?.friends.length === 0 && <Text style={{ color: colors.textMuted }}>Пока никого. Найдите друзей по нику выше.</Text>}
        {data?.friends.map((f) => (
          <Row key={f.friendshipId}>
            <Avatar name={f.user.displayName} url={f.user.avatarUrl} avatarId={f.user.avatarId} status={f.status} />
            <View style={{ flex: 1 }}>
              <Text onPress={() => router.push(`/user/${f.user.id}`)} style={{ color: colors.text, fontWeight: '600' }}>{f.user.displayName}</Text>
              <Text style={{ color: f.status === 'offline' ? colors.textMuted : colors.success, fontSize: 12 }}>{STATUS_TEXT[f.status]}</Text>
            </View>
            {myRoom.data && myRoom.data.status === 'WAITING' && f.status !== 'offline' && (
              <Button
                title="Позвать"
                variant="secondary"
                onPress={() => inviteToRoom(myRoom.data!.code, f.user.id).then(() => Alert.alert('Приглашение отправлено')).catch((e: Error) => Alert.alert('Не получилось', e.message))}
              />
            )}
            <View>
              <Button title="Чат" variant="secondary" onPress={() => router.push(`/chat/${f.user.id}`)} />
              {f.unread > 0 && (
                <View style={{ position: 'absolute', right: -4, top: -6, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{f.unread}</Text>
                </View>
              )}
            </View>
          </Row>
        ))}

        {(data?.outgoing.length ?? 0) > 0 && (
          <View style={{ gap: 8 }}>
            <Text style={{ color: colors.textMuted }}>Исходящие заявки</Text>
            {data?.outgoing.map((r) => (
              <Row key={r.friendshipId}>
                <Avatar name={r.user.displayName} url={r.user.avatarUrl} avatarId={r.user.avatarId} size={36} />
                <Text style={{ flex: 1, color: colors.text }}>{r.user.displayName}</Text>
                <Button title="Отменить" variant="secondary" onPress={() => actions.remove.mutate(r.user.id)} />
              </Row>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
