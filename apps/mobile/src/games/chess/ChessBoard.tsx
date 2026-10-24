import { chess } from '@nastolki/game-engine';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { feedback } from '@/services/feedback';
import { useSettings } from '@/stores/settings';
import { boardTheme } from '@/theme/cosmetics';
import { useTheme } from '@/theme/useTheme';
import type { GameUIProps } from '../registry';

type View_ = chess.ChessView;
type Move = chess.ChessMove;

const GLYPH: Record<string, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

/** Интерфейс шахмат: тап по фигуре → подсветка ходов → тап по клетке. Доска переворачивается для чёрных. */
export function ChessBoard({ view, seat, legal, myTurn, onAction, disabled, orientation }: GameUIProps<View_, Move>) {
  const { colors } = useTheme();
  const { light: LIGHT, dark: DARK } = boardTheme(useSettings((s) => s.boardTheme));
  const { width } = useWindowDimensions();
  const size = Math.min(width - 24, 480);
  const cell = size / 8;
  const flip = (orientation ?? seat) === 1;

  const [selected, setSelected] = useState<number | null>(null);
  const [promo, setPromo] = useState<{ from: number; to: number } | null>(null);

  // Любое изменение позиции сбрасывает выбор.
  useEffect(() => {
    setSelected(null);
    setPromo(null);
  }, [view.moves.length]);

  const targets = useMemo(() => new Map<number, Move[]>(), []);
  targets.clear();
  if (selected !== null) for (const m of legal) if (m.from === selected) targets.set(m.to, [...(targets.get(m.to) ?? []), m]);

  const kingSq = view.inCheck ? view.board.indexOf(view.turn === 0 ? 'K' : 'k') : -1;
  const canMove = myTurn && !disabled;

  const press = (sq: number) => {
    if (!canMove) return;
    const t = targets.get(sq);
    if (selected !== null && t) {
      feedback.move();
      if (t.some((m) => m.promo)) setPromo({ from: selected, to: sq });
      else onAction({ from: selected, to: sq });
      setSelected(null);
      return;
    }
    const piece = view.board[sq] ?? '';
    const mine = piece !== '' && chess.colorOf(piece) === seat;
    if (mine && legal.some((m) => m.from === sq)) {
      feedback.tap();
      setSelected(sq === selected ? null : sq);
    } else {
      setSelected(null);
    }
  };

  const order = Array.from({ length: 64 }, (_, i) => {
    const row = Math.floor(i / 8);
    const col = i % 8;
    return (flip ? row : 7 - row) * 8 + (flip ? 7 - col : col);
  });

  return (
    <View style={{ alignItems: 'center', gap: 12 }}>
      <View style={{ width: size, height: size, flexDirection: 'row', flexWrap: 'wrap', borderRadius: 6, overflow: 'hidden' }}>
        {order.map((sq, i) => {
          const f = sq & 7;
          const r = sq >> 3;
          const piece = view.board[sq] ?? '';
          const isLight = (f + r) % 2 === 1;
          const isLast = view.last && (view.last.from === sq || view.last.to === sq);
          const target = targets.has(sq);
          const bg = sq === kingSq ? '#E5484D' : sq === selected ? '#F6F669' : isLast ? (isLight ? '#F5F27A' : '#DAC34B') : isLight ? LIGHT : DARK;
          const white = piece !== '' && chess.colorOf(piece) === 0;
          return (
            <Pressable
              key={sq}
              onPress={() => press(sq)}
              accessibilityLabel={`${chess.sqName(sq)} ${piece ? GLYPH[piece.toLowerCase()] : 'пусто'}`}
              style={{ width: cell, height: cell, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}
            >
              {piece !== '' && (
                <Animated.Text
                  // key меняется при смене позиции фигуры, поэтому на новой клетке она «выпрыгивает»
                  key={`${sq}${piece}${view.last?.to === sq ? view.moves.length : 0}`}
                  entering={view.last?.to === sq ? ZoomIn.duration(160) : undefined}
                  style={{
                    fontSize: cell * 0.78,
                    lineHeight: cell * 0.95,
                    color: white ? '#FFFFFF' : '#1B1A17',
                    textShadowColor: white ? '#000' : '#fff',
                    textShadowRadius: white ? 3 : 1,
                    textShadowOffset: { width: 0, height: 0 },
                    includeFontPadding: false,
                  }}
                >
                  {GLYPH[piece.toLowerCase()]}
                </Animated.Text>
              )}
              {target && (
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    width: piece ? cell * 0.9 : cell * 0.3,
                    height: piece ? cell * 0.9 : cell * 0.3,
                    borderRadius: cell,
                    backgroundColor: piece ? 'transparent' : 'rgba(0,0,0,0.25)',
                    borderWidth: piece ? 3 : 0,
                    borderColor: 'rgba(0,0,0,0.3)',
                  }}
                />
              )}
              {i % 8 === 0 && <Text style={{ position: 'absolute', left: 2, top: 1, fontSize: 9, color: isLight ? DARK : LIGHT }}>{r + 1}</Text>}
              {i >= 56 && <Text style={{ position: 'absolute', right: 2, bottom: 0, fontSize: 9, color: isLight ? DARK : LIGHT }}>{'abcdefgh'[f]}</Text>}
            </Pressable>
          );
        })}

        {promo && (
          <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#fff', marginBottom: 8, fontWeight: '700' }}>Превратить пешку в…</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {(['q', 'r', 'b', 'n'] as const).map((p) => (
                <Pressable
                  key={p}
                  onPress={() => {
                    onAction({ ...promo, promo: p });
                    setPromo(null);
                  }}
                  style={{ width: cell * 1.1, height: cell * 1.1, borderRadius: 10, backgroundColor: LIGHT, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ fontSize: cell * 0.8, color: seat === 0 ? '#fff' : '#1B1A17', textShadowColor: seat === 0 ? '#000' : '#fff', textShadowRadius: 3 }}>{GLYPH[p]}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </View>

      {view.inCheck && !view.result && <Text style={{ color: colors.danger, fontWeight: '700' }}>Шах!</Text>}
      <Text numberOfLines={2} style={{ color: colors.textMuted, width: size, fontSize: 13 }}>
        {view.moves.length === 0
          ? 'Ходов пока нет'
          : view.moves.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${m}` : m)).join('  ')}
      </Text>
    </View>
  );
}
