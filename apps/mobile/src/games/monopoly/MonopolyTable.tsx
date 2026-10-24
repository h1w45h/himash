import { monopoly } from '@nastolki/game-engine';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { Button } from '@/components/ui';
import { feedback } from '@/services/feedback';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import type { GameUIProps } from '../registry';

type V = monopoly.MonopolyView;
type A = monopoly.MonopolyAction;
type Offer = monopoly.Offer;

const PLAYER_COLORS = ['#E5484D', '#2F6FED', '#2E9D5B', '#F2A413', '#8E4EC6', '#12A5A5'];
const DICE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const KIND_ICON: Record<string, string> = { go: '▶', rail: '🚂', util: '💡', tax: '💰', chance: '❓', chest: '🎁', jail: '⛓', parking: '🅿', gotojail: '👮' };

/** Клетка i → (строка, столбец) на сетке 11×11; «Старт» — правый нижний угол, движение против часовой. */
function gridPos(i: number): [number, number] {
  if (i <= 10) return [10, 10 - i];
  if (i <= 19) return [20 - i, 0];
  if (i <= 30) return [0, i - 20];
  return [i - 30, 10];
}

const sqOf = (i: number) => monopoly.BOARD[i] as monopoly.Square;
const money = (n: number) => `${n} ₽`;

export function MonopolyTable({ view, seat, legal, myTurn, onAction, disabled }: GameUIProps<V, A>) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const size = Math.min(width - 24, 520);
  const cell = size / 11;
  const [sel, setSel] = useState<number | null>(null);
  const [tradeOpen, setTradeOpen] = useState(false);
  const can = myTurn && !disabled;

  const act = (a: A) => {
    feedback.move();
    onAction(a);
  };
  const has = (t: A['t']) => legal.find((a) => a.t === t);
  const forSq = (t: 'build' | 'sellHouse' | 'mortgage' | 'unmortgage', i: number) => legal.find((a) => a.t === t && a.sq === i);

  const mine = useMemo(() => view.props.flatMap((p, i) => (p && p.owner === seat ? [i] : [])), [view.props, seat]);
  const me = view.cash[seat] ?? 0;
  const pos = view.pos[seat] ?? 0;
  const auction = view.auction;
  const bidOptions = legal.filter((a): a is Extract<A, { t: 'bid' }> => a.t === 'bid');

  return (
    <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 24 }}>
      {/* Игроки */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {Array.from({ length: view.players }, (_, p) => (
          <View key={p} style={{ flexGrow: 1, minWidth: 96, padding: 8, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 2, borderColor: view.turn === p && !view.finished ? PLAYER_COLORS[p] : colors.border, opacity: view.bankrupt[p] ? 0.4 : 1 }}>
            <Text style={{ color: PLAYER_COLORS[p], fontWeight: '800' }}>● Игрок {p + 1}{p === seat ? ' (вы)' : ''}</Text>
            <Text style={{ color: colors.text }}>{view.bankrupt[p] ? 'банкрот' : money(view.cash[p] ?? 0)}</Text>
            <Text style={{ color: colors.textMuted, fontSize: 11 }}>
              {view.props.filter((x) => x?.owner === p).length} собств.{view.jail[p] ? ' · ⛓' : ''}{(view.jailCards[p]?.length ?? 0) > 0 ? ` · 🎫${view.jailCards[p]!.length}` : ''}
            </Text>
          </View>
        ))}
      </View>

      {/* Поле */}
      <View style={{ width: size, height: size, alignSelf: 'center', backgroundColor: '#CFE8D5', borderRadius: 8, overflow: 'hidden' }}>
        {monopoly.BOARD.map((q, i) => {
          const [r, c] = gridPos(i);
          const p = view.props[i];
          const strip = q.kind === 'street' ? monopoly.GROUP_COLORS[q.group] : null;
          const horizontal = r === 0 || r === 10;
          const corner = (r === 0 || r === 10) && (c === 0 || c === 10);
          const here = Array.from({ length: view.players }, (_, pl) => pl).filter((pl) => view.pos[pl] === i && !view.bankrupt[pl]);
          return (
            <Pressable
              key={i}
              onPress={() => setSel(i)}
              accessibilityLabel={q.name}
              style={{
                position: 'absolute', left: c * cell, top: r * cell, width: cell, height: cell,
                backgroundColor: '#F6F1E3', borderWidth: p ? 2 : 0.5, borderColor: p ? PLAYER_COLORS[p.owner] : '#9AA39B',
                opacity: p?.mortgaged ? 0.5 : 1, alignItems: 'center', justifyContent: 'center',
              }}
            >
              {strip && (
                <View style={{ position: 'absolute', backgroundColor: strip, ...(horizontal ? { left: 0, right: 0, height: cell * 0.25, [r === 0 ? 'bottom' : 'top']: 0 } : { top: 0, bottom: 0, width: cell * 0.25, [c === 0 ? 'right' : 'left']: 0 }) }} />
              )}
              <Text style={{ fontSize: cell * (corner ? 0.5 : 0.4) }}>{KIND_ICON[q.kind] ?? (p && p.houses > 0 ? (p.houses === 5 ? '🏨' : '🏠'.repeat(Math.min(p.houses, 2)) + (p.houses > 2 ? p.houses : '')) : '')}</Text>
              <View style={{ position: 'absolute', bottom: 1, flexDirection: 'row' }}>
                {here.map((pl) => (
                  <View key={pl} style={{ width: cell * 0.28, height: cell * 0.28, borderRadius: cell, backgroundColor: PLAYER_COLORS[pl], borderWidth: 1, borderColor: '#fff', marginHorizontal: 0.5 }} />
                ))}
              </View>
            </Pressable>
          );
        })}

        {/* Центр поля: кубики и подсказка */}
        <View style={{ position: 'absolute', left: cell * 1.2, top: cell * 1.2, width: cell * 8.6, height: cell * 8.6, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Text style={{ fontSize: cell * 1.6 }}>{view.dice ? `${DICE[view.dice[0]]} ${DICE[view.dice[1]]}` : '🎲'}</Text>
          {view.log.slice(-3).map((l, i, arr) => (
            <Text key={i} numberOfLines={2} style={{ fontSize: 11, color: '#2A2A2A', opacity: 0.55 + (i / arr.length) * 0.45, textAlign: 'center', paddingHorizontal: 8 }}>{l}</Text>
          ))}
        </View>
      </View>

      {/* Действия по фазе */}
      <View style={{ gap: 8, backgroundColor: colors.surface, padding: 12, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border }}>
        {view.finished ? (
          <Text style={{ color: colors.text, fontWeight: '700' }}>Партия окончена</Text>
        ) : view.phase === 'roll' || view.phase === 'manage' ? (
          <>
            <Text style={{ color: colors.text, fontWeight: '700' }}>
              {can ? (view.phase === 'roll' ? (view.jail[seat] ? 'Вы в тюрьме' : 'Ваш ход') : 'Можно строить, закладывать, обмениваться') : `Ходит игрок ${view.turn + 1}`}
            </Text>
            {can && has('roll') && <Button title={view.phase === 'manage' ? 'Бросить ещё раз (дубль)' : 'Бросить кубики'} onPress={() => act({ t: 'roll' })} />}
            {can && has('jailPay') && <Button title="Заплатить 50 ₽ и выйти" variant="secondary" onPress={() => act({ t: 'jailPay' })} />}
            {can && has('jailCard') && <Button title="Карточка освобождения" variant="secondary" onPress={() => act({ t: 'jailCard' })} />}
            {can && has('endTurn') && <Button title="Закончить ход" onPress={() => act({ t: 'endTurn' })} />}
            {can && <Button title="Предложить обмен" variant="secondary" onPress={() => setTradeOpen(true)} />}
          </>
        ) : view.phase === 'buy' ? (
          <>
            <Text style={{ color: colors.text, fontWeight: '700' }}>{can ? `Купить «${sqOf(pos).name}»?` : `Игрок ${view.turn + 1} решает, покупать ли «${sqOf(view.pos[view.turn] ?? 0).name}»`}</Text>
            {can && has('buy') && <Button title={`Купить за ${money((sqOf(pos) as { price: number }).price)}`} onPress={() => act({ t: 'buy' })} />}
            {can && <Button title="Отказаться (аукцион)" variant="secondary" onPress={() => act({ t: 'decline' })} />}
          </>
        ) : view.phase === 'auction' && auction ? (
          <>
            <Text style={{ color: colors.text, fontWeight: '700' }}>Аукцион: «{sqOf(auction.sq).name}»</Text>
            <Text style={{ color: colors.textMuted }}>
              Ставка: {auction.bidder === null ? 'пока нет' : `${money(auction.high)} (игрок ${auction.bidder + 1})`} · торгуется игрок {(auction.active[auction.idx] ?? 0) + 1}
            </Text>
            {can && (
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                {bidOptions.map((b) => <Button key={b.amount} title={money(b.amount)} variant="secondary" onPress={() => act(b)} />)}
                <Button title="Пас" onPress={() => act({ t: 'passBid' })} />
              </View>
            )}
          </>
        ) : view.phase === 'debt' ? (
          <>
            <Text style={{ color: colors.danger, fontWeight: '700' }}>
              {can ? `Долг ${money(view.debt?.creditors.reduce((n, c) => n + c.amount, 0) ?? 0)}: заложите имущество или продайте дома` : `Игрок ${view.turn + 1} в долгах`}
            </Text>
            {can && <Button title="Объявить банкротство" variant="secondary" onPress={() => act({ t: 'bankrupt' })} />}
          </>
        ) : view.phase === 'trade' && view.trade ? (
          <>
            <Text style={{ color: colors.text, fontWeight: '700' }}>Обмен: игрок {view.trade.from + 1} → игрок {view.trade.to + 1}</Text>
            <OfferText label="Отдаёт" offer={view.trade.give} />
            <OfferText label="Получает" offer={view.trade.get} />
            {can && (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}><Button title="Принять" onPress={() => act({ t: 'accept' })} /></View>
                <View style={{ flex: 1 }}><Button title="Отклонить" variant="secondary" onPress={() => act({ t: 'reject' })} /></View>
              </View>
            )}
          </>
        ) : null}
      </View>

      {/* Моё имущество */}
      {mine.length > 0 && (
        <View style={{ gap: 6 }}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>Моё имущество · {money(me)}</Text>
          {mine.map((i) => {
            const q = sqOf(i);
            const p = view.props[i]!;
            return (
              <Pressable key={i} onPress={() => setSel(i)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
                <View style={{ width: 10, height: 24, borderRadius: 3, backgroundColor: q.kind === 'street' ? monopoly.GROUP_COLORS[q.group] : '#888' }} />
                <Text style={{ flex: 1, color: colors.text }}>{q.name}</Text>
                <Text style={{ color: colors.textMuted }}>{p.mortgaged ? 'в залоге' : p.houses === 5 ? '🏨' : p.houses ? `🏠×${p.houses}` : ''}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* Карточка клетки */}
      {sel !== null && (
        <SquareSheet
          i={sel}
          view={view}
          onClose={() => setSel(null)}
          actions={(['build', 'sellHouse', 'mortgage', 'unmortgage'] as const).flatMap((t) => {
            const a = can ? forSq(t, sel) : undefined;
            return a ? [{ t, a }] : [];
          })}
          onAction={(a) => {
            act(a);
            setSel(null);
          }}
        />
      )}

      {tradeOpen && (
        <TradeBuilder
          view={view}
          seat={seat}
          onClose={() => setTradeOpen(false)}
          onSend={(a) => {
            setTradeOpen(false);
            act(a);
          }}
        />
      )}
    </ScrollView>
  );
}

function OfferText({ label, offer }: { label: string; offer: Offer }) {
  const { colors } = useTheme();
  const parts = [offer.cash ? money(offer.cash) : '', ...offer.props.map((i) => sqOf(i).name), offer.cards ? `🎫×${offer.cards}` : ''].filter(Boolean);
  return <Text style={{ color: colors.textMuted }}>{label}: {parts.length ? parts.join(', ') : '—'}</Text>;
}

const ACTION_TITLES: Record<string, string> = { build: 'Построить дом/отель', sellHouse: 'Продать постройку', mortgage: 'Заложить', unmortgage: 'Выкупить' };

function SquareSheet({ i, view, onClose, actions, onAction }: { i: number; view: V; onClose: () => void; actions: { t: string; a: A }[]; onAction: (a: A) => void }) {
  const { colors } = useTheme();
  const q = sqOf(i);
  const p = view.props[i];
  return (
    <Pressable onPress={onClose} style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, gap: 6, borderWidth: 2, borderColor: colors.primary }}>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>{q.name}</Text>
      {q.kind === 'street' && (
        <>
          <Text style={{ color: colors.textMuted }}>Цена {money(q.price)} · дом {money(q.houseCost)}</Text>
          <Text style={{ color: colors.textMuted }}>Аренда: {q.rent[0]} · 1 дом {q.rent[1]} · 2 дома {q.rent[2]} · 3 дома {q.rent[3]} · 4 дома {q.rent[4]} · отель {q.rent[5]}</Text>
        </>
      )}
      {q.kind === 'rail' && <Text style={{ color: colors.textMuted }}>Цена {money(q.price)} · аренда 25 / 50 / 100 / 200 за 1–4 вокзала</Text>}
      {q.kind === 'util' && <Text style={{ color: colors.textMuted }}>Цена {money(q.price)} · аренда 4× очков (10× при двух службах)</Text>}
      {q.kind === 'tax' && <Text style={{ color: colors.textMuted }}>Налог {money(q.amount)}</Text>}
      {p && <Text style={{ color: colors.text }}>Владелец: игрок {p.owner + 1}{p.mortgaged ? ' · в залоге' : ''}{p.houses ? ` · ${p.houses === 5 ? 'отель' : `домов: ${p.houses}`}` : ''}</Text>}
      {actions.map(({ t, a }) => (
        <Button key={t} title={ACTION_TITLES[t] ?? t} variant="secondary" onPress={() => onAction(a)} />
      ))}
    </Pressable>
  );
}

function TradeBuilder({ view, seat, onClose, onSend }: { view: V; seat: number; onClose: () => void; onSend: (a: A) => void }) {
  const { colors } = useTheme();
  const others = Array.from({ length: view.players }, (_, p) => p).filter((p) => p !== seat && !view.bankrupt[p]);
  const [to, setTo] = useState<number>(others[0] ?? 0);
  const [giveProps, setGiveProps] = useState<number[]>([]);
  const [getProps, setGetProps] = useState<number[]>([]);
  const [giveCash, setGiveCash] = useState(0);
  const [getCash, setGetCash] = useState(0);
  const owned = (p: number) => view.props.flatMap((x, i) => (x && x.owner === p ? [i] : []));
  const toggle = (list: number[], set: (v: number[]) => void, i: number) => set(list.includes(i) ? list.filter((x) => x !== i) : [...list, i]);

  const Chips = ({ items, picked, onPick }: { items: number[]; picked: number[]; onPick: (i: number) => void }) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {items.length === 0 && <Text style={{ color: colors.textMuted }}>нет собственности</Text>}
      {items.map((i) => (
        <Pressable key={i} onPress={() => onPick(i)} style={{ paddingHorizontal: 8, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: picked.includes(i) ? colors.primary : colors.surfaceAlt }}>
          <Text style={{ color: picked.includes(i) ? colors.onPrimary : colors.text, fontSize: 12 }}>{sqOf(i).name}</Text>
        </Pressable>
      ))}
    </View>
  );
  const stepper = (v: number, set: (n: number) => void, max: number) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Button title="−50" variant="secondary" onPress={() => set(Math.max(0, v - 50))} />
      <Text style={{ color: colors.text, minWidth: 70, textAlign: 'center' }}>{money(v)}</Text>
      <Button title="+50" variant="secondary" onPress={() => set(Math.min(max, v + 50))} />
    </View>
  );

  return (
    <View style={{ gap: 8, backgroundColor: colors.surface, padding: 12, borderRadius: radius.lg, borderWidth: 2, borderColor: colors.primary }}>
      <Text style={{ color: colors.text, fontSize: 17, fontWeight: '800' }}>Обмен</Text>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        {others.map((p) => <Button key={p} title={`Игрок ${p + 1}`} variant={p === to ? 'primary' : 'secondary'} onPress={() => { setTo(p); setGetProps([]); setGetCash(0); }} />)}
      </View>
      <Text style={{ color: colors.text, fontWeight: '700' }}>Вы отдаёте</Text>
      <Chips items={owned(seat)} picked={giveProps} onPick={(i) => toggle(giveProps, setGiveProps, i)} />
      {stepper(giveCash, setGiveCash, view.cash[seat] ?? 0)}
      <Text style={{ color: colors.text, fontWeight: '700' }}>Вы получаете</Text>
      <Chips items={owned(to)} picked={getProps} onPick={(i) => toggle(getProps, setGetProps, i)} />
      {stepper(getCash, setGetCash, view.cash[to] ?? 0)}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><Button title="Отправить" onPress={() => onSend({ t: 'trade', to, give: { cash: giveCash, props: giveProps, cards: 0 }, get: { cash: getCash, props: getProps, cards: 0 } })} /></View>
        <View style={{ flex: 1 }}><Button title="Отмена" variant="secondary" onPress={onClose} /></View>
      </View>
    </View>
  );
}
