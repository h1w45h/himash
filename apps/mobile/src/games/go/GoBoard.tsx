import { go } from '@nastolki/game-engine';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { Button } from '@/components/ui';
import { feedback } from '@/services/feedback';
import { useTheme } from '@/theme/useTheme';
import type { GameUIProps } from '../registry';

type S = go.GoState;
type A = go.GoAction;

const WOOD = '#DCB35C';

/**
 * Доска Го. Касание ставит «призрачный» камень, повторное касание (или кнопка) подтверждает ход —
 * так случайные нажатия на маленькой доске не превращаются в ошибки.
 */
export function GoBoard({ view, seat, legal, myTurn, onAction, disabled }: GameUIProps<S, A>) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const N = view.size;
  const W = Math.min(width - 24, 480);
  const cell = W / (N + 1);
  const [ghost, setGhost] = useState<number | null>(null);
  const can = myTurn && !disabled;

  useEffect(() => setGhost(null), [view.moves]);

  const legalSet = useMemo(() => new Set(legal.filter((a): a is Extract<A, { t: 'place' }> => a.t === 'place').map((a) => a.at)), [legal]);
  const pass = legal.find((a) => a.t === 'pass');
  const score = go.areaScore(view.board, N);
  const hoshi = N === 9 ? [2, 4, 6] : N === 13 ? [3, 6, 9] : [3, 9, 15];
  const mine = seat === 0 ? 1 : 2;

  const tap = (i: number) => {
    if (!can) return;
    if (ghost === i) {
      feedback.move();
      onAction({ t: 'place', at: i });
      setGhost(null);
    } else if (legalSet.has(i)) {
      feedback.tap();
      setGhost(i);
    } else setGhost(null);
  };

  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      <View style={{ flexDirection: 'row', gap: 14 }}>
        <Text style={{ color: colors.text }}>⚫ Чёрные: {score.black} (взято {view.captures[0]})</Text>
        <Text style={{ color: colors.text }}>⚪ Белые: {score.white + view.komi} (взято {view.captures[1]})</Text>
      </View>

      <View style={{ width: W, height: W, backgroundColor: WOOD, borderRadius: 6 }}>
        {Array.from({ length: N }, (_, k) => (
          <View key={`h${k}`}>
            <View style={{ position: 'absolute', left: cell, top: cell * (k + 1) - 0.5, width: cell * (N - 1), height: 1, backgroundColor: '#5B4520' }} />
            <View style={{ position: 'absolute', top: cell, left: cell * (k + 1) - 0.5, height: cell * (N - 1), width: 1, backgroundColor: '#5B4520' }} />
          </View>
        ))}
        {hoshi.flatMap((x) => hoshi.map((y) => (
          <View key={`s${x}${y}`} style={{ position: 'absolute', left: cell * (x + 1) - 3, top: cell * (y + 1) - 3, width: 6, height: 6, borderRadius: 3, backgroundColor: '#5B4520' }} />
        )))}

        {view.board.map((v, i) => {
          const x = i % N;
          const y = (i / N) | 0;
          const left = cell * (x + 1) - cell / 2;
          const top = cell * (y + 1) - cell / 2;
          return (
            <Pressable key={i} onPress={() => tap(i)} style={{ position: 'absolute', left, top, width: cell, height: cell, alignItems: 'center', justifyContent: 'center' }}>
              {v !== 0 && (
                <Animated.View
                  key={`${i}${v}${view.last === i ? view.moves : 0}`}
                  entering={view.last === i ? ZoomIn.duration(140) : undefined}
                  style={{ width: cell * 0.92, height: cell * 0.92, borderRadius: cell, backgroundColor: v === 1 ? '#1B1A17' : '#F7F3E8', borderWidth: 1, borderColor: v === 1 ? '#000' : '#BDB59F', alignItems: 'center', justifyContent: 'center' }}
                >
                  {view.last === i && <View style={{ width: cell * 0.3, height: cell * 0.3, borderRadius: cell, borderWidth: 2, borderColor: v === 1 ? '#fff' : '#222' }} />}
                </Animated.View>
              )}
              {ghost === i && <View style={{ width: cell * 0.9, height: cell * 0.9, borderRadius: cell, backgroundColor: mine === 1 ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.7)', borderWidth: 2, borderColor: '#E8710A' }} />}
            </Pressable>
          );
        })}
      </View>

      <Text style={{ color: colors.text, fontWeight: '600' }}>
        {view.result ? `Партия окончена — победа ${view.result.winner === 0 ? 'чёрных' : 'белых'}` : can ? (ghost === null ? 'Ваш ход — коснитесь пункта' : 'Коснитесь ещё раз или нажмите «Поставить»') : `Ходят ${view.turn === 0 ? 'чёрные' : 'белые'}`}
        {view.lastMove === 'pass' ? ' · соперник спасовал' : ''}
      </Text>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        {can && ghost !== null && <Button title="Поставить" onPress={() => { feedback.move(); onAction({ t: 'place', at: ghost }); setGhost(null); }} />}
        {can && pass && <Button title={view.passes === 1 ? 'Пас (закончить партию)' : 'Пас'} variant="secondary" onPress={() => onAction(pass)} />}
      </View>
      <Text style={{ color: colors.textMuted, fontSize: 12, textAlign: 'center' }}>Подсчёт по площади, коми {view.komi}. Мёртвые камни нужно снять игрой до паса.</Text>
    </View>
  );
}
