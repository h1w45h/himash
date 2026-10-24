import { checkers } from '@nastolki/game-engine';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { feedback } from '@/services/feedback';
import { useTheme } from '@/theme/useTheme';
import type { GameUIProps } from '../registry';

type S = checkers.CheckersState;
type Move = checkers.CheckersMove;

const LIGHT = '#EBD7B0';
const DARK = '#8B5A2B';

const startsWith = (path: number[], prefix: number[]) => prefix.every((v, i) => path[i] === v);

/**
 * Русские шашки. Ход собирается по клеткам: нажмите шашку, затем последовательно клетки посадки
 * (при серии взятий — каждую). Допустимые продолжения подсвечиваются.
 */
export function CheckersBoard({ view, seat, legal, myTurn, onAction, disabled, orientation }: GameUIProps<S, Move>) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const size = Math.min(width - 24, 480);
  const cell = size / 8;
  const flip = (orientation ?? seat) === 1;
  const [prefix, setPrefix] = useState<number[]>([]);

  useEffect(() => setPrefix([]), [view.moves.length]);

  const next = useMemo(() => {
    const set = new Set<number>();
    if (prefix.length) for (const m of legal) if (startsWith(m.path, prefix) && m.path.length > prefix.length) set.add(m.path[prefix.length]!);
    return set;
  }, [legal, prefix]);
  const movable = useMemo(() => new Set(legal.map((m) => m.path[0]!)), [legal]);
  const canMove = myTurn && !disabled;

  const press = (sq: number) => {
    if (!canMove) return;
    if (prefix.length && next.has(sq)) {
      const p = [...prefix, sq];
      const done = legal.find((m) => m.path.length === p.length && startsWith(m.path, p));
      feedback.move();
      if (done) {
        onAction(done);
        setPrefix([]);
      } else {
        setPrefix(p);
      }
      return;
    }
    if (movable.has(sq)) {
      feedback.tap();
      setPrefix(prefix[0] === sq && prefix.length === 1 ? [] : [sq]);
    } else {
      setPrefix([]);
    }
  };

  const order = Array.from({ length: 64 }, (_, i) => {
    const row = Math.floor(i / 8);
    const col = i % 8;
    return (flip ? row : 7 - row) * 8 + (flip ? 7 - col : col);
  });
  const lastSet = new Set(view.last ?? []);

  return (
    <View style={{ alignItems: 'center', gap: 12 }}>
      <View style={{ width: size, height: size, flexDirection: 'row', flexWrap: 'wrap', borderRadius: 6, overflow: 'hidden' }}>
        {order.map((sq) => {
          const piece = view.board[sq] ?? '';
          const dark = checkers.isDark(sq);
          const white = piece === 'w' || piece === 'W';
          const king = piece === 'W' || piece === 'B';
          const selected = prefix[0] === sq;
          const bg = !dark ? LIGHT : selected ? '#C28A3E' : lastSet.has(sq) ? '#A87438' : DARK;
          return (
            <Pressable key={sq} onPress={() => press(sq)} style={{ width: cell, height: cell, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
              {piece !== '' && (
                <Animated.View
                  key={`${sq}${piece}${view.last?.at(-1) === sq ? view.moves.length : 0}`}
                  entering={view.last?.at(-1) === sq ? ZoomIn.duration(160) : undefined}
                  style={{
                    width: cell * 0.78, height: cell * 0.78, borderRadius: cell, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: white ? '#F7F3E8' : '#2B2622', borderWidth: 3, borderColor: white ? '#CFC6AE' : '#0E0C0A',
                    opacity: canMove && movable.has(sq) ? 1 : 0.96,
                  }}
                >
                  {king && <Text style={{ fontSize: cell * 0.42, color: white ? '#8B5A2B' : '#E8C36A' }}>♛</Text>}
                </Animated.View>
              )}
              {next.has(sq) && (
                <View pointerEvents="none" style={{ position: 'absolute', width: cell * 0.32, height: cell * 0.32, borderRadius: cell, backgroundColor: 'rgba(255,255,255,0.55)' }} />
              )}
            </Pressable>
          );
        })}
      </View>
      {canMove && prefix.length === 0 && legal.some((m) => m.path.length > 2 || Math.abs((m.path[1]! >> 3) - (m.path[0]! >> 3)) > 1) && (
        <Text style={{ color: colors.danger, fontWeight: '700' }}>Взятие обязательно</Text>
      )}
      <Text numberOfLines={2} style={{ color: colors.textMuted, width: size, fontSize: 13 }}>
        {view.moves.length === 0 ? 'Ходов пока нет' : view.moves.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${m}` : m)).join('  ')}
      </Text>
    </View>
  );
}
