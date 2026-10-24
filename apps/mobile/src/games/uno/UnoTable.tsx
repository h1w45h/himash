import { uno } from '@nastolki/game-engine';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Button } from '@/components/ui';
import { feedback } from '@/services/feedback';
import { useTheme } from '@/theme/useTheme';
import type { GameUIProps } from '../registry';

type V = uno.UnoView;
type A = uno.UnoAction;
type Card = uno.UnoCard;

const COLOR_HEX: Record<uno.Color, string> = { R: '#D7263D', Y: '#F2B705', G: '#2E9D5B', B: '#2B59C3' };
const SYMBOL: Record<string, string> = { skip: '⊘', reverse: '⇄', draw2: '+2', wild: '★', wild4: '+4' };
const label = (c: Card) => (c.kind === 'num' ? String(c.n) : SYMBOL[c.kind]);

function UnoCardView({ card, w = 56, dim, lift }: { card: Card; w?: number; dim?: boolean; lift?: boolean }) {
  const bg = card.color ? COLOR_HEX[card.color] : '#1F1F24';
  return (
    <View style={{ width: w, height: w * 1.5, borderRadius: 9, backgroundColor: bg, borderWidth: 3, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', opacity: dim ? 0.45 : 1, transform: [{ translateY: lift ? -8 : 0 }] }}>
      {card.color === null && (
        <View style={{ position: 'absolute', width: w - 6, height: w * 1.5 - 6, borderRadius: 6, overflow: 'hidden', flexDirection: 'row', flexWrap: 'wrap', opacity: 0.9 }}>
          {(['R', 'Y', 'G', 'B'] as const).map((c) => <View key={c} style={{ width: '50%', height: '50%', backgroundColor: COLOR_HEX[c] }} />)}
        </View>
      )}
      <Text style={{ color: '#fff', fontWeight: '900', fontSize: w * 0.5, textShadowColor: '#000', textShadowRadius: card.color === null ? 4 : 0 }}>{label(card)}</Text>
    </View>
  );
}

/** Стол Uno: соперники, стопка и колода, рука; дикие карты запрашивают цвет, «UNO!» — переключатель. */
export function UnoTable({ view, seat, legal, myTurn, onAction, disabled }: GameUIProps<V, A>) {
  const { colors } = useTheme();
  const [pick, setPick] = useState<Card | null>(null);
  const [callUno, setCallUno] = useState(true);
  const can = myTurn && !disabled;

  useEffect(() => setPick(null), [view.top, view.hand.length, view.turn]);

  const plays = legal.filter((a): a is Extract<A, { t: 'play' }> => a.t === 'play');
  const playable = (c: Card) => can && plays.some((p) => uno.sameCard(p.card, c));
  const send = (card: Card, color?: uno.Color) => {
    feedback.move();
    onAction({ t: 'play', card, ...(color ? { color } : {}), ...(view.hand.length === 2 && callUno ? { uno: true } : {}) });
  };
  const tap = (c: Card) => {
    if (!playable(c)) return;
    if (c.color === null) setPick(c);
    else send(c);
  };
  const others = Array.from({ length: view.players }, (_, i) => i).filter((i) => i !== seat);
  const has = (t: A['t']) => legal.some((a) => a.t === t);

  return (
    <View style={{ flex: 1, gap: 12 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
        {others.map((o) => (
          <View key={o} style={{ padding: 8, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 2, borderColor: view.turn === o && !view.finished ? colors.primary : colors.border, alignItems: 'center', minWidth: 72 }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>Игрок {o + 1}</Text>
            <Text style={{ color: view.handCounts[o] === 1 ? colors.danger : colors.textMuted, fontWeight: view.handCounts[o] === 1 ? '800' : '400' }}>
              🂠 {view.handCounts[o]}{view.handCounts[o] === 1 ? ' UNO!' : ''}
            </Text>
            {view.uncalled === o && <Text style={{ color: colors.danger, fontSize: 11 }}>не сказал UNO</Text>}
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 22 }}>
        <Pressable disabled={!can || !has('draw')} onPress={() => { feedback.tap(); onAction({ t: 'draw' }); }} accessibilityLabel="Взять карту">
          <View style={{ width: 56, height: 84, borderRadius: 9, backgroundColor: '#1F1F24', borderWidth: 3, borderColor: can && has('draw') ? colors.primary : '#fff', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#E5484D', fontWeight: '900' }}>UNO</Text>
            <Text style={{ color: '#aaa', fontSize: 11 }}>{view.deckCount}</Text>
          </View>
        </Pressable>
        <Animated.View key={`${view.top.color}${view.top.kind}${view.top.n}${view.hand.length}`} entering={FadeInDown.duration(180)}>
          <UnoCardView card={view.top} w={64} />
        </Animated.View>
        <View style={{ alignItems: 'center', gap: 4 }}>
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: COLOR_HEX[view.color], borderWidth: 2, borderColor: '#fff' }} />
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>{view.dir === 1 ? '↻' : '↺'}</Text>
        </View>
      </View>

      <Text style={{ color: colors.text, textAlign: 'center', fontWeight: '600' }}>
        {view.finished ? (view.winner === seat ? 'Вы победили! 🎉' : `Победил игрок ${(view.winner ?? 0) + 1}`)
          : can ? (view.drawn ? 'Сыграйте взятую карту или пропустите ход' : plays.length ? 'Ваш ход' : 'Нет подходящих карт — возьмите из колоды')
          : `Ходит игрок ${view.turn + 1}`}
      </Text>

      {pick && (
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: colors.text }}>Цвет:</Text>
          {uno.COLORS.map((c) => (
            <Pressable key={c} onPress={() => { send(pick, c); setPick(null); }} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: COLOR_HEX[c], borderWidth: 3, borderColor: '#fff' }} />
          ))}
        </View>
      )}

      <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        {can && has('pass') && <Button title="Пропустить ход" variant="secondary" onPress={() => onAction({ t: 'pass' })} />}
        {can && has('catch') && <Button title="Поймать: нет UNO!" onPress={() => onAction({ t: 'catch' })} />}
        {view.hand.length === 2 && <Button title={callUno ? 'Скажу «UNO!» ✓' : 'Без «UNO!»'} variant="secondary" onPress={() => setCallUno((v) => !v)} />}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingTop: 12, paddingHorizontal: 6, gap: 6, alignItems: 'flex-end' }} style={{ flexGrow: 0 }}>
        {view.hand.map((c, i) => (
          <Pressable key={`${i}${c.color}${c.kind}${c.n}`} onPress={() => tap(c)}>
            <UnoCardView card={c} dim={can && !playable(c)} lift={playable(c)} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
