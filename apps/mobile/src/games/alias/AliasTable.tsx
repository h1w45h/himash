import { alias } from '@nastolki/game-engine';
import { ScrollView, Text, View } from 'react-native';
import { Button } from '@/components/ui';
import { feedback } from '@/services/feedback';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import type { GameUIProps } from '../registry';

type V = alias.AliasView;
type A = alias.AliasAction;
const TEAM_COLOR = ['#D7263D', '#2B59C3'];

/** Стол «Элиаса»: счёт команд, большое слово для объясняющего и кнопки «Угадано / Пропуск». */
export function AliasTable({ view, seat, legal, myTurn, onAction, disabled }: GameUIProps<V, A>) {
  const { colors } = useTheme();
  const can = myTurn && !disabled;
  const myTeam = seat % 2;
  const send = (t: A['t']) => {
    const a = legal.find((x) => x.t === t);
    if (a) {
      feedback.move();
      onAction(a);
    }
  };
  const ok = view.round.filter((r) => r.ok).length;

  return (
    <View style={{ flex: 1, gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'center' }}>
        {alias.TEAM_NAMES.map((name, t) => (
          <View key={t} style={{ flex: 1, padding: 12, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 3, borderColor: view.turn === t && !view.finished ? TEAM_COLOR[t] : colors.border, alignItems: 'center' }}>
            <Text style={{ color: TEAM_COLOR[t], fontWeight: '800' }}>{name}{myTeam === t ? ' (вы)' : ''}</Text>
            <Text style={{ color: colors.text, fontSize: 30, fontWeight: '900' }}>{view.scores[t]}</Text>
            <Text style={{ color: colors.textMuted, fontSize: 11 }}>цель {view.target}</Text>
          </View>
        ))}
      </View>

      {view.finished ? (
        <Text style={{ color: colors.text, textAlign: 'center', fontSize: 20, fontWeight: '800' }}>
          Побеждают {alias.TEAM_NAMES[view.winner ?? 0].toLowerCase()}! {view.winner === myTeam ? '🎉' : ''}
        </Text>
      ) : (
        <View style={{ padding: 16, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', gap: 10 }}>
          <Text style={{ color: colors.textMuted }}>
            Объясняет игрок {view.explainer + 1} ({alias.TEAM_NAMES[view.turn].toLowerCase()}) {view.explainer === seat ? '— это вы' : ''}
          </Text>
          {view.phase === 'ready' ? (
            can ? (
              <>
                <Text style={{ color: colors.text, textAlign: 'center' }}>Нажмите «Старт» — пойдёт время. Объясняйте слова в чате или голосом, не называя их и однокоренные.</Text>
                <Button title="Старт" onPress={() => send('start')} />
              </>
            ) : <Text style={{ color: colors.text }}>Ждём начала раунда…</Text>
          ) : can && view.word ? (
            <>
              <Text style={{ color: colors.text, fontSize: 36, fontWeight: '900', textAlign: 'center' }}>{view.word}</Text>
              <View style={{ flexDirection: 'row', gap: 8, alignSelf: 'stretch' }}>
                <View style={{ flex: 1 }}><Button title="✓ Угадано" onPress={() => send('ok')} /></View>
                <View style={{ flex: 1 }}><Button title="Пропуск (−1)" variant="secondary" onPress={() => send('skip')} /></View>
              </View>
              <Button title="Закончить раунд" variant="secondary" onPress={() => send('endRound')} />
            </>
          ) : (
            <Text style={{ color: colors.text, textAlign: 'center' }}>
              {view.turn === myTeam ? 'Угадывайте слово — пишите варианты в чате!' : 'Ход соперников. Можно следить за раундом.'}
            </Text>
          )}
          <Text style={{ color: colors.textMuted }}>В этом раунде угадано: {ok}, пропущено: {view.round.length - ok}</Text>
        </View>
      )}

      <ScrollView style={{ maxHeight: 130 }}>
        {[...view.round].reverse().map((r, i) => (
          <Text key={i} style={{ color: r.ok ? colors.success : colors.danger }}>{r.ok ? '✓' : '✗'} {r.word}</Text>
        ))}
      </ScrollView>
    </View>
  );
}
