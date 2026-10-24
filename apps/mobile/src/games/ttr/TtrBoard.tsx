import { ticketToRide as ttr } from '@nastolki/game-engine';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { Button } from '@/components/ui';
import { feedback } from '@/services/feedback';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import type { GameUIProps } from '../registry';

type V = ttr.TtrView;
type A = ttr.TtrAction;
type Claim = Extract<A, { t: 'claim' }>;

const PLAYER_COLORS = ['#E5484D', '#2F6FED', '#2E9D5B', '#F2A413', '#8E4EC6'];
const hex = (c: number) => ttr.COLOR_HEX[c] ?? '#999';
const cardName = (c: number) => (c === ttr.LOCO ? 'локомотив' : ttr.CAR_COLORS[c]);

function CardChip({ color, n, onPress, w = 44 }: { color: number; n?: number; onPress?: () => void; w?: number }) {
  const loco = color === ttr.LOCO;
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={{ width: w, height: w * 1.35, borderRadius: 6, backgroundColor: loco ? '#6A5ACD' : hex(color), borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: w * 0.45 }}>{loco ? '🚂' : ''}</Text>
      {n !== undefined && <Text style={{ color: color === 5 || color === 3 ? '#222' : '#fff', fontWeight: '900', fontSize: 15 }}>{n}</Text>}
    </Pressable>
  );
}

/** «Билет на поезд»: карта, открытые карты, рука, билеты и панель занятия маршрута. */
export function TtrBoard({ view, seat, legal, myTurn, onAction, disabled }: GameUIProps<V, A>) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const W = Math.min(width - 24, 520);
  const H = W * 1.05;
  const can = myTurn && !disabled;
  const [route, setRoute] = useState<number | null>(null);
  const [keep, setKeep] = useState<number[]>([]);
  useEffect(() => {
    setRoute(null);
    setKeep([]);
  }, [view.turn, view.drawn, view.pending?.length, view.scores.join()]);

  const claims = legal.filter((a): a is Claim => a.t === 'claim');
  const claimable = new Set(claims.map((c) => c.route));
  const drawDeck = legal.find((a) => a.t === 'drawDeck');
  const drawTickets = legal.find((a) => a.t === 'drawTickets');
  const px = (c: number) => ({ x: (ttr.CITIES[c]!.x / 100) * (W - 40) + 20, y: (ttr.CITIES[c]!.y / 100) * (H - 40) + 20 });

  const act = (a: A) => {
    feedback.move();
    onAction(a);
  };

  const Route = ({ i }: { i: number }) => {
    const r = ttr.ROUTES[i]!;
    const a = px(r.a);
    const b = px(r.b);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    const off = r.twin === undefined ? 0 : i < r.twin ? -5 : 5;
    const nx = (-dy / dist) * off;
    const ny = (dx / dist) * off;
    const owner = view.owner[i]!;
    const color = owner >= 0 ? PLAYER_COLORS[owner]! : hex(r.color);
    const pieceLen = (dist / r.length) * 0.78;
    const free = owner === -1;
    return (
      <>
        {Array.from({ length: r.length }, (_, k) => {
          const t = (k + 0.5) / r.length;
          return (
            <View key={k} style={{
              position: 'absolute', left: a.x + dx * t + nx - pieceLen / 2, top: a.y + dy * t + ny - 4, width: pieceLen, height: 8, borderRadius: 3,
              backgroundColor: color, borderWidth: owner >= 0 ? 2 : 1, borderColor: owner >= 0 ? '#fff' : '#00000055', transform: [{ rotate: `${ang}rad` }],
              opacity: free && r.color === ttr.ANY ? 0.55 : 1,
            }} />
          );
        })}
        {free && claimable.has(i) && can && (
          <Pressable onPress={() => setRoute(route === i ? null : i)} style={{ position: 'absolute', left: a.x + dx / 2 + nx - 15, top: a.y + dy / 2 + ny - 15, width: 30, height: 30, borderRadius: 15, backgroundColor: route === i ? '#E8710A' : 'rgba(255,255,255,0.55)', borderWidth: 2, borderColor: '#E8710A' }} />
        )}
      </>
    );
  };

  return (
    <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 24 }}>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        {view.scores.map((sc, p) => (
          <View key={p} style={{ padding: 8, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 2, borderColor: view.turn === p && !view.finished ? PLAYER_COLORS[p] : colors.border, minWidth: 82 }}>
            <Text style={{ color: PLAYER_COLORS[p], fontWeight: '800' }}>● {p === seat ? 'Вы' : `Игрок ${p + 1}`}</Text>
            <Text style={{ color: colors.text }}>{sc} очк. · 🚆 {view.trains[p]}</Text>
            <Text style={{ color: colors.textMuted, fontSize: 11 }}>карт {view.handCounts[p]} · билетов {view.ticketCounts[p]}</Text>
          </View>
        ))}
      </View>

      <View style={{ width: W, height: H, alignSelf: 'center', backgroundColor: '#DCE9D5', borderRadius: 10, overflow: 'hidden' }}>
        {ttr.ROUTES.map((_, i) => <Route key={i} i={i} />)}
        {ttr.CITIES.map((c, i) => {
          const p = px(i);
          return (
            <View key={i} style={{ position: 'absolute', left: p.x - 6, top: p.y - 6, alignItems: 'center' }}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#fff', borderWidth: 3, borderColor: '#333' }} />
              <Text style={{ position: 'absolute', top: 12, fontSize: 9, fontWeight: '700', color: '#222', width: 90, textAlign: 'center' }}>{c.name}</Text>
            </View>
          );
        })}
      </View>

      {route !== null && can && (
        <View style={{ padding: 10, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.primary, gap: 6 }}>
          <Text style={{ color: colors.text, fontWeight: '800' }}>
            {ttr.CITIES[ttr.ROUTES[route]!.a]!.name} — {ttr.CITIES[ttr.ROUTES[route]!.b]!.name} · {ttr.ROUTES[route]!.length} ваг. · +{ttr.routePoints(ttr.ROUTES[route]!.length)}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {claims.filter((c) => c.route === route).map((c, k) => (
              <Button key={k} title={`${ttr.ROUTES[route]!.length - c.locos}× ${cardName(c.color)}${c.locos ? ` + ${c.locos} 🚂` : ''}`} variant="secondary" onPress={() => act(c)} />
            ))}
          </View>
        </View>
      )}

      {view.pending ? (
        <View style={{ padding: 10, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.primary, gap: 6 }}>
          <Text style={{ color: colors.text, fontWeight: '800' }}>Выберите билеты (минимум {view.pendingMin})</Text>
          {view.pending.map((id, i) => {
            const t = ttr.TICKETS[id]!;
            const on = keep.includes(i);
            return (
              <Pressable key={id} onPress={() => setKeep(on ? keep.filter((x) => x !== i) : [...keep, i])} style={{ padding: 8, borderRadius: radius.md, borderWidth: 2, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? 'rgba(232,113,10,0.12)' : 'transparent' }}>
                <Text style={{ color: colors.text }}>{on ? '✓ ' : ''}{ttr.CITIES[t.a]!.name} → {ttr.CITIES[t.b]!.name} <Text style={{ fontWeight: '800' }}>({t.points})</Text></Text>
              </Pressable>
            );
          })}
          {can && <Button title="Оставить выбранные" disabled={keep.length < view.pendingMin} onPress={() => act({ t: 'keepTickets', keep: [...keep].sort((a, b) => a - b) })} />}
        </View>
      ) : (
        <>
          <Text style={{ color: colors.text, fontWeight: '600', textAlign: 'center' }}>
            {view.finished ? 'Игра окончена' : can ? (view.drawn ? 'Возьмите вторую карту' : 'Ваш ход: возьмите карты, займите маршрут или возьмите билеты') : `Ходит игрок ${view.turn + 1}`}
            {view.endTrigger !== null && !view.finished ? ' · ПОСЛЕДНИЙ КРУГ' : ''}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'center', alignItems: 'center' }}>
            {can && drawDeck ? (
              <Pressable onPress={() => act(drawDeck)} style={{ width: 44, height: 59, borderRadius: 6, backgroundColor: '#333', borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 11 }}>{view.deckCount}</Text>
              </Pressable>
            ) : <View style={{ width: 44, height: 59, borderRadius: 6, backgroundColor: '#555', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontSize: 11 }}>{view.deckCount}</Text></View>}
            {view.faceUp.map((c, idx) => {
              const a = legal.find((x) => x.t === 'drawFaceUp' && x.idx === idx);
              return <CardChip key={idx} color={c} onPress={can && a ? () => act(a) : undefined} />;
            })}
          </View>
          {can && drawTickets && <Button title="Взять билеты (3)" variant="secondary" onPress={() => act(drawTickets)} />}
        </>
      )}

      <Text style={{ color: colors.text, fontWeight: '700' }}>Ваши карты</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {view.hand.map((n, c) => (n > 0 ? <CardChip key={c} color={c} n={n} /> : null))}
      </View>

      <Text style={{ color: colors.text, fontWeight: '700' }}>Ваши билеты</Text>
      {view.myTickets.map((id, i) => {
        const t = ttr.TICKETS[id]!;
        return (
          <Text key={id} style={{ color: view.completed[i] ? colors.success : colors.text }}>
            {view.completed[i] ? '✓' : '○'} {ttr.CITIES[t.a]!.name} → {ttr.CITIES[t.b]!.name} ({t.points})
          </Text>
        );
      })}
      {view.final && (
        <Text style={{ color: colors.textMuted }}>
          Итог: билеты {view.final.tickets.map((x, i) => `И${i + 1} ${x >= 0 ? '+' : ''}${x}`).join(' · ')}; самый длинный путь — игрок{view.final.longestBonus.filter(Boolean).length > 1 ? 'и' : ''} {view.final.longestBonus.map((b, i) => (b ? i + 1 : 0)).filter(Boolean).join(', ')} (+10)
        </Text>
      )}
      <Text numberOfLines={3} style={{ color: colors.textMuted, fontSize: 12 }}>{view.log.slice(-3).join(' ')}</Text>
    </ScrollView>
  );
}
