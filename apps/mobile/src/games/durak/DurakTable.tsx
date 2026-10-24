import { durak } from '@nastolki/game-engine';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { Button } from '@/components/ui';
import { feedback } from '@/services/feedback';
import { useTheme } from '@/theme/useTheme';
import type { GameUIProps } from '../registry';

type V = durak.DurakView;
type A = durak.DurakAction;
type Card = durak.Card;

const SUIT: Record<Card['suit'], string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RANK: Record<number, string> = { 11: 'В', 12: 'Д', 13: 'К', 14: 'Т' };
const rankLabel = (r: number) => RANK[r] ?? String(r);
const isRed = (c: Card) => c.suit === 'H' || c.suit === 'D';
const label = (c: Card) => `${rankLabel(c.rank)}${SUIT[c.suit]}`;

function CardFace({ card, w = 52, selected, dim, trump }: { card: Card; w?: number; selected?: boolean; dim?: boolean; trump?: boolean }) {
  const h = w * 1.4;
  return (
    <View
      style={{
        width: w, height: h, borderRadius: 7, backgroundColor: '#FFFDF7', borderWidth: trump ? 2 : 1,
        borderColor: selected ? '#E8710A' : trump ? '#C99700' : '#B9B3A3', padding: 4, opacity: dim ? 0.45 : 1,
        transform: [{ translateY: selected ? -10 : 0 }],
      }}
    >
      <Text style={{ color: isRed(card) ? '#C62828' : '#1B1A17', fontWeight: '800', fontSize: w * 0.32 }}>{rankLabel(card.rank)}</Text>
      <Text style={{ color: isRed(card) ? '#C62828' : '#1B1A17', fontSize: w * 0.34 }}>{SUIT[card.suit]}</Text>
      <Text style={{ position: 'absolute', right: 5, bottom: 2, color: isRed(card) ? '#C62828' : '#1B1A17', fontSize: w * 0.55 }}>{SUIT[card.suit]}</Text>
    </View>
  );
}

function CardBack({ w = 30 }: { w?: number }) {
  return <View style={{ width: w, height: w * 1.4, borderRadius: 5, backgroundColor: '#2B4C7E', borderWidth: 2, borderColor: '#E6EAF2' }} />;
}

const same = (a: Card, b: Card) => a.rank === b.rank && a.suit === b.suit;
const cardOf = (a: A): Card | null => ('card' in a ? a.card : null);

/** Стол «Дурака»: оппоненты, колода с козырем, пары карт на столе, моя рука и контекстные кнопки. */
export function DurakTable({ view, seat, legal, myTurn, onAction, disabled }: GameUIProps<V, A>) {
  const { colors } = useTheme();
  const [picked, setPicked] = useState<Card | null>(null);

  // Любое изменение стола или руки сбрасывает выбор.
  const sig = `${view.table.length}${view.table.filter((p) => p.defense).length}${view.hand.length}${view.phase}${view.defender}`;
  useEffect(() => setPicked(null), [sig]);

  const canAct = myTurn && !disabled;
  const options = (card: Card) => legal.filter((a) => { const c = cardOf(a); return c && same(c, card); });
  const playable = (card: Card) => canAct && options(card).length > 0;

  const tapCard = (card: Card) => {
    if (!playable(card)) return;
    const opts = options(card);
    if (opts.length === 1) {
      feedback.move();
      onAction(opts[0]!);
    } else {
      feedback.tap();
      setPicked(same(picked ?? ({} as Card), card) ? null : card);
    }
  };

  const take = legal.find((a) => a.t === 'take');
  const pass = legal.find((a) => a.t === 'pass');
  const others = Array.from({ length: view.players }, (_, i) => i).filter((i) => i !== seat);

  const phaseHint = (() => {
    if (view.finished) return view.loser === null ? 'Ничья' : view.loser === seat ? 'Вы остались «дураком»' : 'Партия окончена';
    if (!canAct) return view.phase === 'defend' ? `Игрок ${view.defender + 1} отбивается…` : 'Ход соперника…';
    if (view.phase === 'lead') return 'Ваш заход: выберите карту';
    if (view.phase === 'defend') return 'Побейте карту или возьмите';
    return view.taking ? 'Можно подкинуть карты' : 'Подкиньте карту или скажите «Бито»';
  })();

  return (
    <View style={{ flex: 1, gap: 10 }}>
      {/* Оппоненты */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-around', flexWrap: 'wrap', gap: 6 }}>
        {others.map((o) => (
          <View key={o} style={{ alignItems: 'center', opacity: view.out.includes(o) ? 0.4 : 1 }}>
            <View style={{ flexDirection: 'row' }}>
              {Array.from({ length: Math.min(view.handCounts[o] ?? 0, 6) }, (_, i) => (
                <View key={i} style={{ marginLeft: i ? -18 : 0 }}><CardBack /></View>
              ))}
            </View>
            <Text style={{ color: colors.text, fontSize: 12 }}>
              Игрок {o + 1} · {view.handCounts[o]} {view.attacker === o ? '⚔' : ''}{view.defender === o ? '🛡' : ''}{view.out.includes(o) ? '✓' : ''}
            </Text>
          </View>
        ))}
      </View>

      {/* Колода, козырь, отбой */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <View style={{ alignItems: 'center' }}>
          {view.trumpCard ? (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ transform: [{ rotate: '90deg' }], marginRight: -8 }}><CardFace card={view.trumpCard} w={36} trump /></View>
              <CardBack w={36} />
            </View>
          ) : (
            <Text style={{ color: colors.text, fontSize: 28 }}>{SUIT[view.trump]}</Text>
          )}
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>Колода: {view.deckCount} · козырь {SUIT[view.trump]}</Text>
        </View>
        <Text style={{ color: colors.textMuted, fontSize: 12 }}>Бито: {view.discard}</Text>
      </View>

      {/* Стол */}
      <View style={{ minHeight: 100, flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', alignItems: 'center' }}>
        {view.table.length === 0 && <Text style={{ color: colors.textMuted }}>Стол пуст</Text>}
        {view.table.map((p, idx) => {
          const target = picked ? legal.find((a) => a.t === 'beat' && a.idx === idx && same(a.card, picked)) : undefined;
          return (
            <Pressable key={idx} disabled={!target} onPress={() => target && (feedback.move(), onAction(target))} style={{ width: 64, height: 86 }}>
              <Animated.View entering={ZoomIn.duration(180)} style={{ position: 'absolute', left: 0, top: 0, borderRadius: 8, borderWidth: target ? 3 : 0, borderColor: '#E8710A' }}>
                <CardFace card={p.attack} w={52} trump={p.attack.suit === view.trump} />
              </Animated.View>
              {p.defense && (
                <Animated.View entering={FadeInDown.duration(180)} style={{ position: 'absolute', left: 14, top: 16 }}>
                  <CardFace card={p.defense} w={52} trump={p.defense.suit === view.trump} />
                </Animated.View>
              )}
            </Pressable>
          );
        })}
      </View>

      <Text style={{ color: colors.text, textAlign: 'center', fontWeight: '600' }}>{phaseHint}</Text>

      {/* Выбор действия для карты с несколькими вариантами */}
      {picked && (
        <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          {options(picked).map((a, i) =>
            a.t === 'transfer' ? (
              <Button key={i} title={`Перевести ${label(picked)}`} onPress={() => onAction(a)} />
            ) : null,
          )}
          {options(picked).some((a) => a.t === 'beat') && <Text style={{ color: colors.textMuted }}>Нажмите карту на столе, чтобы побить её</Text>}
        </View>
      )}

      {/* Кнопки */}
      <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center' }}>
        {take && <Button title="Беру" variant="secondary" disabled={!canAct} onPress={() => onAction(take)} />}
        {pass && <Button title={view.taking ? 'Хватит' : 'Бито'} variant="secondary" disabled={!canAct} onPress={() => onAction(pass)} />}
      </View>

      {/* Моя рука */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingTop: 14, paddingHorizontal: 6, gap: 6, alignItems: 'flex-end' }} style={{ flexGrow: 0 }}>
        {view.hand.map((c) => (
          <Pressable key={`${c.rank}${c.suit}`} onPress={() => tapCard(c)} accessibilityLabel={label(c)}>
            <CardFace card={c} w={56} selected={!!picked && same(picked, c)} dim={canAct && !playable(c)} trump={c.suit === view.trump} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
