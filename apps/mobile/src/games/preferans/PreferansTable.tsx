import { preferans as pref } from '@nastolki/game-engine';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Button } from '@/components/ui';
import { feedback } from '@/services/feedback';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import type { GameUIProps } from '../registry';

type V = pref.PrefView;
type A = pref.PrefAction;

const RED = (c: number) => pref.suitOf(c) >= 2;
const SUIT_LABEL = ['♠', '♣', '♦', '♥', 'БК'];

function Card({ card, w = 46, selected, dim, onPress }: { card: number; w?: number; selected?: boolean; dim?: boolean; onPress?: () => void }) {
  const color = RED(card) ? '#C62828' : '#1B1A17';
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={{ width: w, height: w * 1.4, borderRadius: 7, backgroundColor: '#FFFDF7', borderWidth: selected ? 3 : 1, borderColor: selected ? '#E8710A' : '#B9B3A3', padding: 3, opacity: dim ? 0.4 : 1, transform: [{ translateY: selected ? -10 : 0 }] }}>
      <Text style={{ color, fontWeight: '800', fontSize: w * 0.32 }}>{pref.RANKS[pref.rankOf(card)]}</Text>
      <Text style={{ color, fontSize: w * 0.5 }}>{pref.SUITS[pref.suitOf(card)]}</Text>
    </Pressable>
  );
}

/** Сетка заявок: строки — уровни 6…10, столбцы — масти и БК; мизер отдельной кнопкой. */
function BidGrid({ min, pick, disabled }: { min: number; pick: (id: number) => void; disabled?: boolean }) {
  const { colors } = useTheme();
  const cell = (id: number, label: string, wide?: boolean) => {
    const on = id >= min && !disabled;
    return (
      <Pressable key={id} disabled={!on} onPress={() => pick(id)} style={{ minWidth: wide ? 88 : 48, paddingVertical: 8, paddingHorizontal: 6, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: on ? colors.surface : colors.surfaceAlt, opacity: on ? 1 : 0.35, alignItems: 'center' }}>
        <Text style={{ color: id !== pref.MISERE_ID && (label.endsWith('♦') || label.endsWith('♥')) ? '#C62828' : colors.text, fontWeight: '800' }}>{label}</Text>
      </Pressable>
    );
  };
  return (
    <View style={{ gap: 4 }}>
      {[6, 7, 8, 9, 10].map((level) => (
        <View key={level} style={{ flexDirection: 'row', gap: 4, justifyContent: 'center' }}>
          {[0, 1, 2, 3, 4].map((suit) => cell(pref.contractId(level, suit), `${level}${SUIT_LABEL[suit]}`))}
        </View>
      ))}
      <View style={{ flexDirection: 'row', justifyContent: 'center' }}>{cell(pref.MISERE_ID, 'мизер', true)}</View>
    </View>
  );
}

/** Стол преферанса: табло (пуля/гора/висты), взятка, торговля, прикуп, висты и моя рука. */
export function PreferansTable({ view, seat, legal, myTurn, onAction, disabled }: GameUIProps<V, A>) {
  const { colors } = useTheme();
  const can = myTurn && !disabled;
  const [sel, setSel] = useState<number[]>([]);
  useEffect(() => setSel([]), [view.phase, view.dealNo]);
  const act = (a: A) => {
    feedback.move();
    onAction(a);
  };
  const lastLabel = (p: number) => {
    const b = view.lastBid[p];
    return b === null || b === undefined ? '' : b === -1 ? 'пас' : pref.contractName(b);
  };
  const role = (p: number) => (view.phase === 'bid' ? lastLabel(p) : p === view.declarer ? (view.allPass ? '' : '🎯 играет') : view.whist[p] === true ? 'вист' : view.whist[p] === false ? 'пас' : '');

  const myHand = view.hands[seat] ?? [];
  const controlled = view.controller === seat && view.openHand >= 0 && view.openHand !== seat ? view.hands[view.openHand] : null;
  const playActs = legal.filter((a): a is Extract<A, { t: 'play' }> => a.t === 'play');
  const playOf = (card: number, owner: number) => playActs.find((a) => a.card === card && (owner === seat ? a.for === undefined : a.for === owner));
  const discard = legal.some((a) => a.t === 'discard');
  const declare = legal.filter((a): a is Extract<A, { t: 'declare' }> => a.t === 'declare');
  const bids = legal.filter((a): a is Extract<A, { t: 'bid' }> => a.t === 'bid');
  const minDeclare = declare.length ? Math.min(...declare.map((d) => d.id)) : 0;
  const minBid = bids.length ? Math.min(...bids.map((b) => b.id)) : 99;

  const status = (() => {
    if (view.finished) return 'Матч окончен';
    if (!myTurn && view.phase !== 'play') return `Ходит игрок ${(view.phase === 'bid' ? view.bidTurn : view.phase === 'whist' ? view.whistTurn : view.declarer) + 1}`;
    switch (view.phase) {
      case 'bid': return 'Ваша заявка';
      case 'discard': return `Прикуп взят. Сбросьте две карты (${sel.length}/2)`;
      case 'declare': return `Назовите игру (не ниже ${pref.contractName(minDeclare)})`;
      case 'whist': return 'Вистуете?';
      case 'play': return view.controller === seat ? (controlled && view.turn !== seat ? `Ходите за игрока ${view.turn + 1}` : 'Ваш ход') : `Ходит игрок ${view.turn + 1}`;
      default: return '';
    }
  })();

  return (
    <ScrollView contentContainerStyle={{ gap: 8, paddingBottom: 24 }}>
      {/* Табло */}
      <View style={{ padding: 8, borderRadius: radius.md, backgroundColor: colors.surface, gap: 4 }}>
        <Text style={{ color: colors.textMuted, fontSize: 12 }}>Раздача {Math.min(view.dealNo + 1, view.deals)} из {view.deals} · сдаёт игрок {view.dealer + 1}</Text>
        <View style={{ flexDirection: 'row' }}>
          {[0, 1, 2].map((p) => (
            <View key={p} style={{ flex: 1 }}>
              <Text style={{ color: view.turn === p && view.phase === 'play' ? colors.primary : colors.text, fontWeight: '800' }}>{p === seat ? 'Вы' : `Игрок ${p + 1}`}</Text>
              <Text style={{ color: colors.text, fontSize: 12 }}>пуля {view.pula[p]} · гора {view.gora[p]}</Text>
              <Text style={{ color: colors.textMuted, fontSize: 11 }}>висты {[0, 1, 2].filter((j) => j !== p).map((j) => `${j + 1}:${view.whists[p]![j]}`).join(' ')}</Text>
              <Text style={{ color: view.standing[p]! >= 0 ? '#2E9D5B' : '#C62828', fontWeight: '700', fontSize: 12 }}>баланс {view.standing[p]! > 0 ? '+' : ''}{view.standing[p]}</Text>
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>{role(p)}{view.phase === 'play' ? ` · взяток ${view.tricks[p]}` : ''}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Игра и взятка */}
      <Text style={{ color: colors.text, fontWeight: '700', textAlign: 'center' }}>
        {view.phase === 'play' || view.phase === 'whist' ? (view.allPass ? 'Распасы' : `Игра: ${view.contract !== null ? pref.contractName(view.contract) : ''} · играет игрок ${view.declarer + 1}`) : ''}
      </Text>
      {view.phase === 'play' && (
        <View style={{ minHeight: 90, flexDirection: 'row', justifyContent: 'center', gap: 16, alignItems: 'center' }}>
          {view.trick.length === 0 && <Text style={{ color: colors.textMuted }}>Стол пуст</Text>}
          {view.trick.map((t) => (
            <View key={t.seat} style={{ alignItems: 'center' }}>
              <Card card={t.card} />
              <Text style={{ color: colors.textMuted, fontSize: 11 }}>{t.seat === seat ? 'Вы' : `И${t.seat + 1}`}</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={{ color: colors.text, textAlign: 'center', fontWeight: '600' }}>{status}</Text>

      {view.phase === 'bid' && can && (
        <View style={{ gap: 6 }}>
          <BidGrid min={minBid} pick={(id) => act({ t: 'bid', id })} />
          <Button title="Пас" variant="secondary" onPress={() => act({ t: 'pass' })} />
        </View>
      )}
      {view.phase === 'declare' && can && <BidGrid min={minDeclare} pick={(id) => act({ t: 'declare', id })} />}
      {view.phase === 'whist' && can && (
        <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center' }}>
          <Button title="Вист" onPress={() => act({ t: 'whist', yes: true })} />
          <Button title="Пас" variant="secondary" onPress={() => act({ t: 'whist', yes: false })} />
        </View>
      )}
      {view.phase === 'discard' && can && discard && (
        <Button title="Сбросить выбранные" disabled={sel.length !== 2} onPress={() => act({ t: 'discard', cards: sel })} />
      )}

      {/* Открытая рука пасующего (видна всем) */}
      {view.openHand >= 0 && view.hands[view.openHand] && view.openHand !== seat && (
        <View style={{ gap: 4 }}>
          <Text style={{ color: colors.textMuted, textAlign: 'center', fontSize: 12 }}>Открытые карты игрока {view.openHand + 1}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, justifyContent: 'center' }}>
            {view.hands[view.openHand]!.map((c) => {
              const a = playOf(c, view.openHand);
              return <Card key={c} card={c} w={38} dim={!!controlled && !a} onPress={can && a ? () => act(a) : undefined} />;
            })}
          </View>
        </View>
      )}

      {/* Моя рука */}
      <Text style={{ color: colors.textMuted, textAlign: 'center', fontSize: 12 }}>
        {view.handCounts.map((n, p) => (p === seat ? '' : `Игрок ${p + 1}: ${n} карт`)).filter(Boolean).join(' · ')}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, justifyContent: 'center', paddingTop: 10 }}>
        {myHand.map((c) => {
          const a = view.phase === 'play' ? playOf(c, seat) : undefined;
          const picking = view.phase === 'discard' && can;
          const on = sel.includes(c);
          return (
            <Card
              key={c}
              card={c}
              selected={on}
              dim={view.phase === 'play' && can && !a && view.turn === seat}
              onPress={picking ? () => setSel(on ? sel.filter((x) => x !== c) : sel.length < 2 ? [...sel, c] : sel) : can && a ? () => act(a) : undefined}
            />
          );
        })}
      </View>
      <Text numberOfLines={3} style={{ color: colors.textMuted, fontSize: 12 }}>{view.log.slice(-3).join(' ')}</Text>
    </ScrollView>
  );
}
