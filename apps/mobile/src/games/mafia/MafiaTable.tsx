import { mafia } from '@nastolki/game-engine';
import { ScrollView, Text, View } from 'react-native';
import { Button } from '@/components/ui';
import { feedback } from '@/services/feedback';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import type { GameUIProps } from '../registry';

type V = mafia.MafiaView;
type A = mafia.MafiaAction;

const ROLE_ICON: Record<mafia.Role, string> = { mafia: '🔪', sheriff: '🕵️', doctor: '💉', civilian: '🙂' };
const NIGHT_PROMPT: Partial<Record<mafia.Role, string>> = {
  mafia: 'Выберите жертву', sheriff: 'Кого проверить?', doctor: 'Кого лечить этой ночью?',
};

/** Стол «Мафии»: игроки, ночные действия по ролям, обсуждение и голосование, журнал событий. */
export function MafiaTable({ view, seat, legal, myTurn, onAction, disabled }: GameUIProps<V, A>) {
  const { colors } = useTheme();
  const can = myTurn && !disabled;
  const act = (a: A) => {
    feedback.move();
    onAction(a);
  };
  const targets = legal.filter((a): a is Extract<A, { target: number }> => 'target' in a && a.target >= 0);
  const skip = legal.find((a) => 'target' in a && a.target === -1);
  const ready = legal.find((a) => a.t === 'ready');
  const imDead = view.alive[seat] === false;

  const verb = (a: Extract<A, { target: number }>) => (a.t === 'kill' ? 'Убить' : a.t === 'check' ? 'Проверить' : a.t === 'heal' ? 'Лечить' : 'Голос против');

  return (
    <View style={{ flex: 1, gap: 10 }}>
      <View style={{ alignItems: 'center', padding: 10, borderRadius: radius.lg, backgroundColor: view.phase === 'night' ? '#1B2540' : '#FFF4D6' }}>
        <Text style={{ fontSize: 28 }}>{view.phase === 'night' ? '🌙' : view.phase === 'discuss' ? '☀️' : '🗳'}</Text>
        <Text style={{ color: view.phase === 'night' ? '#E8ECFF' : '#3B2F10', fontWeight: '800' }}>
          {view.phase === 'night' ? `Ночь ${view.day + 1}` : view.phase === 'discuss' ? `День ${view.day}: обсуждение` : `День ${view.day}: голосование`}
        </Text>
      </View>

      <View style={{ padding: 10, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
        <Text style={{ color: colors.text, fontWeight: '800' }}>
          Ваша роль: {view.me ? `${ROLE_ICON[view.me]} ${mafia.ROLE_NAMES[view.me]}` : 'наблюдатель'}{imDead ? ' · вы выбыли' : ''}
        </Text>
        {view.me === 'mafia' && <Text style={{ color: colors.textMuted, fontSize: 12 }}>Ваши сообщники: {view.roles.map((r, i) => (r === 'mafia' && i !== seat ? `Игрок ${i + 1}` : null)).filter(Boolean).join(', ') || 'нет'}</Text>}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {Array.from({ length: view.players }, (_, i) => {
          const role = view.roles[i];
          const check = view.checks[i];
          return (
            <View key={i} style={{ minWidth: 92, padding: 8, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 2, borderColor: i === seat ? colors.primary : colors.border, opacity: view.alive[i] ? 1 : 0.4 }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>{view.alive[i] ? '' : '💀 '}Игрок {i + 1}{i === seat ? ' (вы)' : ''}</Text>
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                {role ? `${ROLE_ICON[role]} ${mafia.ROLE_NAMES[role]}` : check !== undefined ? (check ? '🔪 мафия (проверено)' : '🙂 мирный (проверено)') : '❔'}
                {view.acted[i] ? ' · ✓' : ''}
              </Text>
              {view.teamVotes[i] !== undefined && view.teamVotes[i]! >= 0 && <Text style={{ color: colors.danger, fontSize: 11 }}>→ Игрок {view.teamVotes[i]! + 1}</Text>}
            </View>
          );
        })}
      </View>

      {view.finished ? (
        <Text style={{ color: colors.text, textAlign: 'center', fontWeight: '800', fontSize: 18 }}>
          {view.winner === 'town' ? 'Победили мирные жители 🎉' : 'Победила мафия 🔪'}
        </Text>
      ) : view.phase === 'night' ? (
        can && view.me ? (
          <View style={{ gap: 6 }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>{NIGHT_PROMPT[view.me]}</Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {targets.map((a) => <Button key={a.target} title={`${verb(a)} ${a.target + 1}`} variant="secondary" onPress={() => act(a)} />)}
              {skip && <Button title="Пропустить" variant="secondary" onPress={() => act(skip)} />}
            </View>
          </View>
        ) : (
          <Text style={{ color: colors.textMuted, textAlign: 'center' }}>{imDead ? 'Вы наблюдаете за ночью…' : view.me === 'civilian' || !view.me ? 'Вы спите… Город ждёт утра.' : 'Вы своё сделали — ждём остальных.'}</Text>
        )
      ) : view.phase === 'discuss' ? (
        <View style={{ gap: 6 }}>
          <Text style={{ color: colors.text }}>Обсудите в чате (кнопка «Чат» внизу), кто подозрителен.</Text>
          {can && ready && <Button title="Готов голосовать" onPress={() => act(ready)} />}
        </View>
      ) : (
        can ? (
          <View style={{ gap: 6 }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>Кого изгнать?</Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {targets.map((a) => <Button key={a.target} title={`Игрок ${a.target + 1}`} variant="secondary" onPress={() => act(a)} />)}
              {skip && <Button title="Воздержаться" variant="secondary" onPress={() => act(skip)} />}
            </View>
          </View>
        ) : <Text style={{ color: colors.textMuted, textAlign: 'center' }}>{imDead ? 'Вы выбыли' : 'Ваш голос принят — ждём остальных'}</Text>
      )}

      <ScrollView style={{ maxHeight: 150 }} contentContainerStyle={{ gap: 3 }}>
        {[...view.log].reverse().map((l, i) => <Text key={i} style={{ color: i === 0 ? colors.text : colors.textMuted, fontSize: 13 }}>{l}</Text>)}
      </ScrollView>
    </View>
  );
}
