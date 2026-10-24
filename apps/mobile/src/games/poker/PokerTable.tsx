import { poker } from '@nastolki/game-engine';
import { Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Button } from '@/components/ui';
import { feedback } from '@/services/feedback';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import type { GameUIProps } from '../registry';

type V = poker.PokerView;
type A = poker.PokerAction;

const RED = (c: number) => (c & 3) === 1 || (c & 3) === 2;

function PCard({ c, w = 44, hidden }: { c?: number; w?: number; hidden?: boolean }) {
  const base = { width: w, height: w * 1.4, borderRadius: 6, alignItems: 'center' as const, justifyContent: 'center' as const };
  if (c === undefined || hidden) {
    return <View style={[base, { backgroundColor: hidden ? '#2B4C7E' : 'rgba(255,255,255,0.12)', borderWidth: 2, borderColor: hidden ? '#E6EAF2' : 'rgba(255,255,255,0.25)' }]} />;
  }
  const label = poker.cardLabel(c);
  return (
    <View style={[base, { backgroundColor: '#FFFDF7', borderWidth: 1, borderColor: '#B9B3A3' }]}>
      <Text style={{ color: RED(c) ? '#C62828' : '#1B1A17', fontWeight: '800', fontSize: w * 0.4 }}>{label}</Text>
    </View>
  );
}

/** Стол Холдема: игроки со стеками и ставками, борд, банк, мои карты и кнопки действий. */
export function PokerTable({ view, seat, legal, myTurn, onAction, disabled }: GameUIProps<V, A>) {
  const { colors } = useTheme();
  const can = myTurn && !disabled;
  const act = (a: A) => {
    feedback.move();
    onAction(a);
  };
  const call = legal.find((a) => a.t === 'call');
  const check = legal.find((a) => a.t === 'check');
  const raises = legal.filter((a): a is Extract<A, { t: 'raise' }> => a.t === 'raise');
  const toCall = Math.max(0, view.currentBet - (view.bets[seat] ?? 0));
  const [sb, bb] = view.blinds;
  const last = view.lastHand;

  const raiseLabel = (to: number) => {
    const maxTo = (view.bets[seat] ?? 0) + (view.stacks[seat] ?? 0);
    return to >= maxTo ? `Олл-ин ${to}` : `${view.currentBet === 0 ? 'Ставка' : 'Рейз до'} ${to}`;
  };

  return (
    <View style={{ flex: 1, gap: 10 }}>
      <Text style={{ color: colors.textMuted, textAlign: 'center' }}>Раздача {view.handNo} · блайнды {sb}/{bb}</Text>

      {last && (
        <View style={{ padding: 8, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 2 }}>
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>Прошлая раздача №{last.handNo}</Text>
          {last.pots.map((p, i) => (
            <Text key={i} style={{ color: colors.text, fontSize: 13 }}>
              {p.winners.map((w) => (w === seat ? 'Вы' : `Игрок ${w + 1}`)).join(', ')} {p.winners.length > 1 ? 'делят' : 'забирает'} {p.amount}{p.hand ? ` — ${p.hand}` : ''}
            </Text>
          ))}
          {Object.keys(last.revealed).length > 0 && (
            <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
              {Object.entries(last.revealed).map(([s, cs]) => (
                <View key={s} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Text style={{ color: colors.textMuted, fontSize: 11 }}>И{Number(s) + 1}</Text>
                  {cs.map((c) => <PCard key={c} c={c} w={22} />)}
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
        {Array.from({ length: view.players }, (_, i) => i).map((i) => {
          const gone = view.out[i];
          const folded = view.folded[i];
          return (
            <View
              key={i}
              style={{
                minWidth: 92, padding: 8, borderRadius: radius.md, backgroundColor: colors.surface, opacity: gone ? 0.35 : folded ? 0.55 : 1,
                borderWidth: 2, borderColor: view.toAct === i ? colors.primary : colors.border,
              }}
            >
              <Text style={{ color: colors.text, fontWeight: '700' }}>{i === seat ? 'Вы' : `Игрок ${i + 1}`}{view.dealer === i ? ' Ⓓ' : ''}</Text>
              <Text style={{ color: colors.text }}>🪙 {view.stacks[i]}</Text>
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                {gone ? 'вылетел' : folded ? 'сбросил' : view.allIn[i] ? 'олл-ин' : (view.bets[i] ?? 0) > 0 ? `ставка ${view.bets[i]}` : ' '}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={{ alignItems: 'center', gap: 8, paddingVertical: 10, borderRadius: 40, backgroundColor: '#1E6B43' }}>
        <Text style={{ color: '#fff', fontWeight: '800' }}>Банк: {view.pot}</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {Array.from({ length: 5 }, (_, i) => (
            <Animated.View key={`${i}-${view.board[i] ?? 'x'}`} entering={view.board[i] !== undefined ? FadeInDown.duration(220) : undefined}>
              <PCard c={view.board[i]} />
            </Animated.View>
          ))}
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center' }}>
        {view.hole.map((c) => <PCard key={c} c={c} w={58} />)}
      </View>

      <Text style={{ color: colors.text, textAlign: 'center', fontWeight: '600' }}>
        {view.finished ? (view.winner === seat ? 'Вы победили! 🏆' : `Победил игрок ${(view.winner ?? 0) + 1}`)
          : view.out[seat] ? 'Вы выбыли'
          : can ? (toCall > 0 ? `Чтобы остаться, нужно ${Math.min(toCall, view.stacks[seat] ?? 0)}` : 'Можно проверить или поставить')
          : view.toAct !== null ? `Ходит игрок ${view.toAct + 1}` : ''}
      </Text>

      {can && (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Button title="Сбросить" variant="secondary" onPress={() => act({ t: 'fold' })} /></View>
            <View style={{ flex: 1 }}>
              {check ? <Button title="Чек" onPress={() => act(check)} /> : call ? <Button title={`Колл ${Math.min(toCall, view.stacks[seat] ?? 0)}`} onPress={() => act(call)} /> : null}
            </View>
          </View>
          {raises.length > 0 && (
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {raises.map((r) => <Button key={r.to} title={raiseLabel(r.to)} variant="secondary" onPress={() => act(r)} />)}
            </View>
          )}
        </View>
      )}
    </View>
  );
}
