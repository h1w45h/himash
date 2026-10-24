import { backgammon } from '@nastolki/game-engine';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { Button } from '@/components/ui';
import { feedback } from '@/services/feedback';
import { useSettings } from '@/stores/settings';
import { boardTheme } from '@/theme/cosmetics';
import { useTheme } from '@/theme/useTheme';
import type { GameUIProps } from '../registry';

type S = backgammon.BackgammonState;
type A = backgammon.BackgammonAction;
type MoveAct = Extract<A, { t: 'move' }>;

const DICE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

/**
 * Длинные нарды. Доска повёрнута так, чтобы ваша голова была справа сверху, дом — справа снизу.
 * Нажмите пункт со своими шашками — подсветятся пункты назначения; нажмите назначение (или «Вывести»).
 */
export function BackgammonBoard({ view, seat, legal, myTurn, onAction, disabled }: GameUIProps<S, A>) {
  const { colors } = useTheme();
  const theme = boardTheme(useSettings((s) => s.boardTheme));
  const { width } = useWindowDimensions();
  const W = Math.min(width - 24, 480);
  const colW = W / 12;
  const half = Math.min(colW * 4.2, 170);
  const [sel, setSel] = useState<number | null>(null);
  const can = myTurn && !disabled;
  const me = seat as 0 | 1;

  useEffect(() => setSel(null), [view.remaining.length, view.turn, view.phase]);

  const moves = legal.filter((a): a is MoveAct => a.t === 'move');
  const roll = legal.find((a) => a.t === 'roll');
  const sources = useMemo(() => new Set(moves.map((m) => m.from)), [moves]);
  const dests = useMemo(() => {
    const map = new Map<number, MoveAct>();
    if (sel !== null) for (const m of moves) if (m.from === sel) map.set(Math.min(sel + m.die, 24), m);
    return map;
  }, [moves, sel]);

  // абсолютная точка ↔ позиция на экране (для чёрных поле повёрнуто на 180°)
  const absOf = (p: number, who: 0 | 1) => (p + 12 * who) % 24;
  const viewIdx = (a: number) => (me === 1 ? (a + 12) % 24 : a);
  const pOf = (a: number) => (a - 12 * me + 24) % 24; // позиция p в моей дорожке для абсолютной точки a

  const count = (a: number): { n: number; owner: 0 | 1 | null } => {
    const w = view.pos[0][a] ?? 0;
    const b = view.pos[1][(a + 12) % 24] ?? 0;
    return w > 0 ? { n: w, owner: 0 } : b > 0 ? { n: b, owner: 1 } : { n: 0, owner: null };
  };

  const tapPoint = (a: number) => {
    if (!can || view.phase !== 'move') return;
    const p = pOf(a);
    if (sel !== null && dests.has(p) && p !== sel) {
      feedback.move();
      const m = dests.get(p)!;
      onAction({ t: 'move', from: m.from, die: m.die });
      setSel(null);
      return;
    }
    if (sources.has(p)) {
      feedback.tap();
      setSel(sel === p ? null : p);
    } else setSel(null);
  };
  const bearOff = dests.get(24);

  const columns = Array.from({ length: 24 }, (_, v) => v);
  const checkerSize = Math.min(colW * 0.86, 30);

  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      <View style={{ flexDirection: 'row', gap: 16 }}>
        <Text style={{ color: colors.text }}>⚪ Белые: {backgammon.pips(view, 0)} · выведено {view.off[0]}</Text>
        <Text style={{ color: colors.text }}>⚫ Чёрные: {backgammon.pips(view, 1)} · выведено {view.off[1]}</Text>
      </View>

      <View style={{ width: W, height: half * 2 + 8, backgroundColor: theme.light, borderRadius: 8, overflow: 'hidden', borderWidth: 3, borderColor: theme.dark }}>
        {columns.map((v) => {
          const top = v < 12;
          const col = top ? 11 - v : v - 12;
          const a = (me === 1 ? (v + 12) % 24 : v); // обратное преобразование
          const { n, owner } = count(a);
          const p = pOf(a);
          const isSrc = can && sources.has(p) && view.phase === 'move';
          const isDest = sel !== null && dests.has(p) && p !== sel;
          const shade = (v + (top ? 0 : 1)) % 2 === 0 ? theme.dark : '#8A6A4A';
          return (
            <Pressable
              key={v}
              onPress={() => tapPoint(a)}
              style={{ position: 'absolute', left: col * colW, top: top ? 0 : half + 8, width: colW, height: half, alignItems: 'center', justifyContent: top ? 'flex-start' : 'flex-end', paddingVertical: 2, backgroundColor: isDest ? 'rgba(80,200,120,0.35)' : sel === p && isSrc ? 'rgba(255,255,100,0.35)' : 'transparent' }}
            >
              <View style={{ position: 'absolute', [top ? 'top' : 'bottom']: 0, width: 0, height: 0, borderLeftWidth: colW / 2, borderRightWidth: colW / 2, borderTopWidth: top ? half * 0.8 : 0, borderBottomWidth: top ? 0 : half * 0.8, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: shade, borderBottomColor: shade, opacity: 0.55 }} />
              {Array.from({ length: Math.min(n, 5) }, (_, i) => (
                <View key={i} style={{ width: checkerSize, height: checkerSize, borderRadius: checkerSize, marginVertical: 0.5, backgroundColor: owner === 0 ? '#F7F3E8' : '#2B2622', borderWidth: 2, borderColor: isSrc && i === Math.min(n, 5) - 1 ? '#E8710A' : owner === 0 ? '#CFC6AE' : '#0E0C0A', alignItems: 'center', justifyContent: 'center' }}>
                  {i === Math.min(n, 5) - 1 && n > 5 && <Text style={{ color: owner === 0 ? '#222' : '#eee', fontSize: 11, fontWeight: '800' }}>{n}</Text>}
                </View>
              ))}
              {v === 0 && <Text style={{ position: 'absolute', bottom: 0, fontSize: 9, color: '#fff' }}>{me === 0 ? 'голова' : ''}</Text>}
            </Pressable>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text style={{ fontSize: 36, color: colors.text }}>{view.dice ? `${DICE[view.dice[0]]} ${DICE[view.dice[1]]}` : '🎲'}</Text>
        {view.remaining.length > 0 && <Text style={{ color: colors.textMuted }}>осталось: {view.remaining.join(', ')}</Text>}
      </View>

      <Text style={{ color: colors.text, fontWeight: '600' }}>
        {view.winner !== null ? `Победа: ${view.winner === 0 ? 'белые' : 'чёрные'}${view.mars ? ' (марс!)' : ''}`
          : can ? (view.phase === 'roll' ? 'Ваш ход — бросайте кости' : sel === null ? 'Выберите шашку' : 'Выберите куда сходить') : `Ходят ${view.turn === 0 ? 'белые' : 'чёрные'}`}
      </Text>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        {can && roll && <Button title="Бросить кости" onPress={() => { feedback.move(); onAction(roll); }} />}
        {can && bearOff && <Button title="Вывести шашку" onPress={() => { feedback.move(); onAction({ t: 'move', from: bearOff.from, die: bearOff.die }); setSel(null); }} />}
      </View>

      <Text numberOfLines={3} style={{ color: colors.textMuted, width: W, fontSize: 12 }}>{view.log.slice(-3).join(' ')}</Text>
    </View>
  );
}
