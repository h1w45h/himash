import { useAuth } from '@/auth/session';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useHistory, useStats } from '@/api/social';
import { useMe, useUpdateProfile, useUpdateSettings } from '@/api/users';
import { Avatar } from '@/components/Avatar';
import { Button, ErrorText, Field } from '@/components/ui';

import { useSettings, type ThemeMode } from '@/stores/settings';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

const THEMES: { mode: ThemeMode; title: string }[] = [
  { mode: 'system', title: 'Системная' },
  { mode: 'light', title: 'Светлая' },
  { mode: 'dark', title: 'Тёмная' },
];
const RESULT = { WIN: ['Победа', 'success'], LOSS: ['Поражение', 'danger'], DRAW: ['Ничья', 'textMuted'], LEFT: ['Выход', 'danger'] } as const;

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 }}>
      <Text style={{ color: colors.text, flex: 1 }}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary }} />
    </View>
  );
}

export default function Profile() {
  const { colors } = useTheme();
  const router = useRouter();
  const { signOut } = useAuth();
  const me = useMe();
  const stats = useStats();
  const history = useHistory();
  const update = useUpdateSettings();
  const updateProfile = useUpdateProfile();
  const local = useSettings();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const s = me.data?.settings;
  const total = stats.data ? stats.data.totals.wins + stats.data.totals.losses + stats.data.totals.draws : 0;
  const Card = ({ children }: { children: React.ReactNode }) => (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 6 }}>{children}</View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Avatar name={me.data?.displayName ?? '?'} url={me.data?.avatarUrl} avatarId={me.data?.avatarId} size={64} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 24, fontWeight: '800' }}>{me.data?.displayName ?? 'Профиль'}</Text>
            <Text style={{ color: colors.textMuted }}>@{me.data?.username} · 🪙 {me.data?.wallet?.coins ?? 0}</Text>
          </View>
          <Button title="🔔" variant="secondary" onPress={() => router.push('/notifications')} />
        </View>

        {editing ? (
          <Card>
            <Field label="Имя" value={name} onChangeText={setName} maxLength={48} />
            <ErrorText>{updateProfile.error?.message}</ErrorText>
            <Button title="Сохранить" loading={updateProfile.isPending} disabled={!name.trim()} onPress={() => updateProfile.mutate({ displayName: name.trim() }, { onSuccess: () => setEditing(false) })} />
          </Card>
        ) : (
          <Button title="Изменить имя" variant="secondary" onPress={() => { setName(me.data?.displayName ?? ''); setEditing(true); }} />
        )}

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}><Button title="🛍 Магазин" variant="secondary" onPress={() => router.push('/shop')} /></View>
          <View style={{ flex: 1 }}><Button title="🏆 Достижения" variant="secondary" onPress={() => router.push('/achievements')} /></View>
        </View>

        <Card>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>Статистика</Text>
          <Text style={{ color: colors.text }}>Партий: {total} · побед {stats.data?.totals.wins ?? 0} · поражений {stats.data?.totals.losses ?? 0} · ничьих {stats.data?.totals.draws ?? 0}</Text>
          {stats.data?.ratings.map((r) => (
            <View key={r.game.slug} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text onPress={() => router.push(`/leaderboard/${r.game.slug}`)} style={{ color: colors.primary }}>{r.game.title}</Text>
              <Text style={{ color: colors.text }}>{r.rating} <Text style={{ color: colors.textMuted }}>(пик {r.peak})</Text></Text>
            </View>
          ))}
          {stats.data?.ratings.length === 0 && <Text style={{ color: colors.textMuted }}>Сыграйте рейтинговую партию, чтобы получить рейтинг.</Text>}
        </Card>

        <Card>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>История партий</Text>
          {history.data?.pages.flatMap((p) => p.items).length === 0 && <Text style={{ color: colors.textMuted }}>Пока пусто</Text>}
          {history.data?.pages.flatMap((p) => p.items).map((m) => {
            const [label, color] = RESULT[m.result ?? 'LOSS'];
            const opp = m.players.filter((p) => p.seat !== m.seat).map((p) => (p.isBot ? '🤖' : p.user?.displayName ?? '—')).join(', ');
            return (
              <View key={m.matchPlayerId} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text }}>{m.game.title} · {opp}</Text>
                  <Text style={{ color: colors.textMuted, fontSize: 11 }}>{m.finishedAt ? new Date(m.finishedAt).toLocaleDateString('ru-RU') : ''}{m.isRated ? ' · рейтинг' : ''}</Text>
                </View>
                <Text style={{ color: colors[color], fontWeight: '700' }}>{label}{m.ratingDelta ? ` ${m.ratingDelta > 0 ? '+' : ''}${m.ratingDelta}` : ''}</Text>
              </View>
            );
          })}
          {history.hasNextPage && <Button title="Ещё" variant="secondary" loading={history.isFetchingNextPage} onPress={() => history.fetchNextPage()} />}
        </Card>

        <Card>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>Настройки</Text>
          <Text style={{ color: colors.textMuted }}>Тема</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {THEMES.map((t) => (
              <View key={t.mode} style={{ flex: 1 }}>
                <Button title={t.title} variant={local.theme === t.mode ? 'primary' : 'secondary'} onPress={() => local.set({ theme: t.mode })} />
              </View>
            ))}
          </View>
          <Toggle label="Вибрация" value={local.haptics} onChange={(v) => local.set({ haptics: v })} />
          <Toggle label="Звуки" value={local.sound} onChange={(v) => local.set({ sound: v })} />
          {s && (
            <>
              <Toggle label="Push-уведомления" value={s.pushEnabled} onChange={(v) => update.mutate({ pushEnabled: v })} />
              <Toggle label="Заявки и приглашения" value={s.pushFriendInvite} onChange={(v) => update.mutate({ pushFriendInvite: v })} />
              <Toggle label="«Ваш ход»" value={s.pushYourTurn} onChange={(v) => update.mutate({ pushYourTurn: v })} />
              <Toggle label="Показывать, что я в сети" value={s.showOnlineStatus} onChange={(v) => update.mutate({ showOnlineStatus: v })} />
              <Text style={{ color: colors.textMuted, marginTop: 6 }}>Кто может звать меня играть</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {([['EVERYONE', 'Все'], ['FRIENDS', 'Друзья'], ['NOBODY', 'Никто']] as const).map(([v, title]) => (
                  <View key={v} style={{ flex: 1 }}>
                    <Button title={title} variant={s.allowInvitesFrom === v ? 'primary' : 'secondary'} onPress={() => update.mutate({ allowInvitesFrom: v })} />
                  </View>
                ))}
              </View>
            </>
          )}
        </Card>

        <Button title="Выйти" variant="secondary" onPress={() => signOut()} />
      </ScrollView>
    </SafeAreaView>
  );
}
