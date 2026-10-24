import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Share, ScrollView, Text, View } from 'react-native';
import { useTournament, useTournamentActions, type TournamentDetail } from '@/api/tournaments';
import { useMe } from '@/api/users';
import { Avatar } from '@/components/Avatar';
import { Button, ErrorText } from '@/components/ui';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

const ROUND_NAMES = (total: number, round: number) => (round === total ? 'Финал' : round === total - 1 ? 'Полуфинал' : round === total - 2 ? 'Четвертьфинал' : `Раунд ${round}`);

export default function TournamentScreen() {
  const { id, code } = useLocalSearchParams<{ id: string; code?: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const me = useMe();
  const { data: t, error } = useTournament(id);
  const actions = useTournamentActions(id);
  if (!t) return <Text style={{ color: colors.danger, padding: 24 }}>{error?.message ?? 'Загрузка…'}</Text>;

  const myId = me.data?.id;
  const joined = t.participants.some((p) => p.userId === myId);
  const isOwner = t.creatorId === myId;
  const rounds = Math.max(1, Math.log2(t.size));
  const byRound = new Map<number, TournamentDetail['matches']>();
  for (const m of t.matches) byRound.set(m.round, [...(byRound.get(m.round) ?? []), m]);
  const err = actions.join.error ?? actions.leave.error ?? actions.start.error ?? actions.cancel.error;
  const name = (m: TournamentDetail['matches'][number], i: number) => m.players[i]?.displayName ?? (m.round === 1 ? 'проход' : 'ожидается');

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Stack.Screen options={{ headerShown: true, title: t.title, headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text }} />
      <Text style={{ color: colors.textMuted }}>
        {t.game.title} · {t.participants.length}/{t.maxPlayers} игроков · взнос {t.entryFee ? `${t.entryFee} 🪙` : 'бесплатно'}
      </Text>
      <Text style={{ color: colors.textMuted }}>Старт: {new Date(t.startsAt).toLocaleString('ru-RU')} · организатор {t.creator.displayName}</Text>
      {t.description && <Text style={{ color: colors.text }}>{t.description}</Text>}
      {t.joinCode && (
        <Button title={`Код приглашения: ${t.joinCode} (поделиться)`} variant="secondary" onPress={() => Share.share({ message: `Присоединяйся к турниру «${t.title}» в «Настолках Онлайн». Код: ${t.joinCode}` })} />
      )}
      <ErrorText>{err?.message}</ErrorText>

      {t.myMatch && <Button title="▶ Играть свою партию" onPress={() => router.push(`/match/${t.myMatch}`)} />}

      {t.status === 'REGISTRATION' && (
        <View style={{ gap: 8 }}>
          {!joined ? (
            <Button title={t.entryFee ? `Участвовать за ${t.entryFee} 🪙` : 'Участвовать'} loading={actions.join.isPending} onPress={() => actions.join.mutate(code)} />
          ) : (
            <Button title="Выйти (взнос вернётся)" variant="secondary" onPress={() => actions.leave.mutate()} />
          )}
          {isOwner && <Button title="Начать сейчас" disabled={t.participants.length < 2} onPress={() => actions.start.mutate()} />}
          {isOwner && <Button title="Отменить турнир" variant="secondary" onPress={() => actions.cancel.mutate()} />}
        </View>
      )}
      {t.status === 'CANCELLED' && <Text style={{ color: colors.danger, fontWeight: '700' }}>Турнир отменён, взносы возвращены</Text>}

      <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800', marginTop: 6 }}>Участники</Text>
      {t.participants.map((p) => (
        <View key={p.userId} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, opacity: p.eliminated ? 0.5 : 1 }}>
          <Avatar name={p.user.displayName} url={p.user.avatarUrl} avatarId={p.user.avatarId} size={32} />
          <Text style={{ color: colors.text, flex: 1 }}>{p.user.displayName}</Text>
          <Text style={{ color: colors.textMuted }}>{p.placement ? `${p.placement === 1 ? '🏆 ' : ''}место ${p.placement}` : p.seed ? `№${p.seed}` : ''}</Text>
        </View>
      ))}

      {t.matches.length > 0 && (
        <>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800', marginTop: 6 }}>Сетка</Text>
          {[...byRound.entries()].map(([round, ms]) => (
            <View key={round} style={{ gap: 6 }}>
              <Text style={{ color: colors.textMuted, fontWeight: '700' }}>{ROUND_NAMES(rounds, round)}</Text>
              {ms.map((m) => (
                <View key={m.id} style={{ padding: 10, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: m.matchId && !m.winnerId ? colors.primary : colors.border }}>
                  {[0, 1].map((i) => (
                    <Text key={i} style={{ color: m.winnerId && m.playerIds[i] === m.winnerId ? colors.success : colors.text, fontWeight: m.winnerId && m.playerIds[i] === m.winnerId ? '800' : '400' }}>
                      {name(m, i)}{m.winnerId && m.playerIds[i] === m.winnerId ? ' ✓' : ''}
                    </Text>
                  ))}
                  {m.matchId && !m.winnerId && <Text style={{ color: colors.primary, fontSize: 12 }}>● идёт партия</Text>}
                </View>
              ))}
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}
