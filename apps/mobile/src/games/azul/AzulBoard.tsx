import { azul } from '@nastolki/game-engine';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { feedback } from '@/services/feedback';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import type { GameUIProps } from '../registry';

type S = azul.AzulState;
type A = azul.AzulAction;

const TILE = ['#2B59C3', '#F2B705', '#D7263D', '#2B2622', '#EFEADB'];
const TILE_BORDER = ['#1B3A85', '#B88A00', '#8F1626', '#000', '#B8B09A'];

function Tile({ color, size = 22, ghost, selected }: { color: number; size?: number; ghost?: boolean; selected?: boolean }) {
  return (
    <View style={{
      width: size, height: size, borderRadius: 4, backgroundColor: ghost ? 'transparent' : TILE[color], borderWidth: selected ? 3 : 2,
      borderColor: selected ? '#E8710A' : ghost ? TILE[color] : TILE_BORDER[color], opacity: ghost ? 0.35 : 1,
    }} />
  );
}

/** Азул: фабрики и центр сверху, ваше поле (линии, стена, пол) ниже, поля соперников — компактно. */
export function AzulBoard({ view, seat, legal, myTurn, onAction, disabled }: GameUIProps<S, A>) {
  const { colors } = useTheme();
  const can = myTurn && !disabled;
  const [sel, setSel] = useState<{ source: number; color: number } | null>(null);
  useEffect(() => setSel(null), [view.turn, view.round, view.center.join(), view.boards[seat]?.floor.length]);

  const pickable = new Set(legal.map((a) => `${a.source}:${a.color}`));
  const lines = new Set(sel ? legal.filter((a) => a.source === sel.source && a.color === sel.color).map((a) => a.line) : []);

  const Source = ({ counts, source, label }: { counts: number[]; source: number; label?: string }) => (
    <View style={{ padding: 6, borderRadius: 40, backgroundColor: colors.surfaceAlt, minWidth: source === -1 ? 140 : 62, minHeight: 62, flexDirection: 'row', flexWrap: 'wrap', gap: 3, alignItems: 'center', justifyContent: 'center' }}>
      {label && <Text style={{ color: colors.textMuted, fontSize: 10, width: '100%', textAlign: 'center' }}>{label}</Text>}
      {counts.flatMap((n, c) => Array.from({ length: n }, (_, k) => (
        <Pressable key={`${c}-${k}`} disabled={!can || !pickable.has(`${source}:${c}`)} onPress={() => { feedback.tap(); setSel(sel?.source === source && sel.color === c ? null : { source, color: c }); }}>
          <Tile color={c} selected={sel?.source === source && sel.color === c} />
        </Pressable>
      )))}
    </View>
  );

  const Board = ({ p, compact }: { p: number; compact?: boolean }) => {
    const b = view.boards[p]!;
    const sz = compact ? 12 : 24;
    const mine = p === seat;
    return (
      <View style={{ padding: compact ? 6 : 10, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 2, borderColor: view.turn === p && !view.finished ? colors.primary : colors.border, gap: 4 }}>
        <Text style={{ color: colors.text, fontWeight: '800' }}>{mine ? 'Вы' : `Игрок ${p + 1}`} · {view.scores[p]} очк.{view.turn === p && !view.finished ? ' · ходит' : ''}</Text>
        <View style={{ flexDirection: 'row', gap: compact ? 8 : 14 }}>
          <View style={{ gap: 2, alignItems: 'flex-end' }}>
            {b.lines.map((l, r) => (
              <Pressable key={r} disabled={!(mine && can && sel && lines.has(r))} onPress={() => { feedback.move(); onAction({ t: 'draft', source: sel!.source, color: sel!.color, line: r }); }}
                style={{ flexDirection: 'row-reverse', gap: 2, padding: 1, borderRadius: 4, backgroundColor: mine && sel && lines.has(r) ? 'rgba(80,200,120,0.4)' : 'transparent' }}>
                {Array.from({ length: r + 1 }, (_, i) => (i < l.count ? <Tile key={i} color={l.color} size={sz} /> : <View key={i} style={{ width: sz, height: sz, borderRadius: 4, borderWidth: 1, borderColor: colors.border }} />))}
              </Pressable>
            ))}
          </View>
          <View style={{ gap: 2 }}>
            {b.wall.map((row, r) => (
              <View key={r} style={{ flexDirection: 'row', gap: 2 }}>
                {row.map((on, c) => <Tile key={c} color={(c - r + 5) % 5} size={sz} ghost={!on} />)}
              </View>
            ))}
          </View>
        </View>
        <Pressable disabled={!(mine && can && sel && lines.has(5))} onPress={() => { feedback.move(); onAction({ t: 'draft', source: sel!.source, color: sel!.color, line: 5 }); }}
          style={{ flexDirection: 'row', gap: 2, alignItems: 'center', padding: 2, borderRadius: 4, backgroundColor: mine && sel && lines.has(5) ? 'rgba(229,72,77,0.25)' : 'transparent' }}>
          <Text style={{ color: colors.textMuted, fontSize: 10, width: 36 }}>Пол:</Text>
          {azul.FLOOR_PENALTY.map((pen, i) => (
            <View key={i} style={{ alignItems: 'center' }}>
              {b.floor[i] !== undefined ? (b.floor[i] === 5 ? <Text style={{ fontSize: sz * 0.8 }}>①</Text> : <Tile color={b.floor[i]!} size={sz * 0.8} />) : <View style={{ width: sz * 0.8, height: sz * 0.8, borderRadius: 3, borderWidth: 1, borderColor: colors.border }} />}
              <Text style={{ color: colors.danger, fontSize: 9 }}>{pen}</Text>
            </View>
          ))}
        </Pressable>
      </View>
    );
  };

  return (
    <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 20 }}>
      <Text style={{ color: colors.textMuted, textAlign: 'center' }}>Раунд {view.round}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
        {view.factories.map((f, i) => <Source key={i} counts={f} source={i} />)}
      </View>
      <View style={{ alignItems: 'center' }}>
        <Source counts={view.center} source={-1} label={view.marker ? 'Центр · ① маркер первого игрока' : 'Центр'} />
      </View>
      <Text style={{ color: colors.text, textAlign: 'center', fontWeight: '600' }}>
        {view.finished ? 'Игра окончена' : can ? (sel ? 'Теперь выберите линию заготовки (или пол)' : 'Возьмите плитки одного цвета с фабрики или из центра') : `Ходит игрок ${view.turn + 1}`}
      </Text>
      <Board p={seat} />
      {Array.from({ length: view.players }, (_, p) => p).filter((p) => p !== seat).map((p) => <Board key={p} p={p} compact />)}
      {view.finished && view.bonuses && <Text style={{ color: colors.text, textAlign: 'center' }}>Бонусы за стену: {view.bonuses.map((b, i) => `И${i + 1} +${b}`).join(' · ')}</Text>}
      <Text numberOfLines={3} style={{ color: colors.textMuted, fontSize: 12 }}>{view.log.slice(-3).join(' ')}</Text>
    </ScrollView>
  );
}
