import { carcassonne as carc } from '@nastolki/game-engine';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Button } from '@/components/ui';
import { feedback } from '@/services/feedback';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import type { GameUIProps } from '../registry';

type V = carc.CarcView;
type A = carc.CarcAction;

const PLAYER = ['#E5484D', '#2F6FED', '#2E9D5B', '#F2A413', '#8E4EC6'];
const FIELD = '#7DB35B';
const CITY = '#B5651D';
const ROAD = '#F1E3B5';
const CELL = 56;

const SIDE_MID: [number, number][] = [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];

/** Положение части плитки (для рисования последователей и меток выбора). */
function featPos(f: carc.Feature): [number, number] {
  if (f.kind === 'monastery') return [0.5, 0.5];
  if (f.kind === 'city' || f.kind === 'road') {
    const ax = f.sides.reduce((a, d) => a + SIDE_MID[d]![0], 0) / f.sides.length;
    const ay = f.sides.reduce((a, d) => a + SIDE_MID[d]![1], 0) / f.sides.length;
    const k = f.kind === 'city' ? 0.72 : 0.8;
    return [0.5 + (ax - 0.5) * k, 0.5 + (ay - 0.5) * k];
  }
  const pts = f.slots.map((j) => {
    const d = Math.floor(j / 3);
    const t = ((j % 3) + 0.5) / 3;
    return d === 0 ? [t, 0.1] : d === 1 ? [0.9, t] : d === 2 ? [1 - t, 0.9] : [0.1, 1 - t];
  });
  const ax = pts.reduce((a, p) => a + p[0]!, 0) / pts.length;
  const ay = pts.reduce((a, p) => a + p[1]!, 0) / pts.length;
  return [0.5 + (ax - 0.5) * 0.7, 0.5 + (ay - 0.5) * 0.7];
}

/** Рисунок плитки из прямоугольников (SVG в проекте не используется). */
function TileView({ type, rot, size, markers, onMarker, meeples }: {
  type: number;
  rot: number;
  size: number;
  markers?: number[];
  onMarker?: (feat: number) => void;
  meeples?: { feat: number; player: number }[];
}) {
  const feats = carc.featuresOf(type, rot);
  const d = 0.36;
  const rect = (side: number): [number, number, number, number] => (side === 0 ? [0, 0, 1, d] : side === 1 ? [1 - d, 0, d, 1] : side === 2 ? [0, 1 - d, 1, d] : [0, 0, d, 1]);
  const box = (r: [number, number, number, number], color: string, key: string, extra?: object) => (
    <View key={key} style={{ position: 'absolute', left: r[0] * size, top: r[1] * size, width: r[2] * size, height: r[3] * size, backgroundColor: color, ...extra }} />
  );
  return (
    <View style={{ width: size, height: size, backgroundColor: FIELD, overflow: 'hidden', borderWidth: 0.5, borderColor: '#2D4A1F' }}>
      {feats.map((f, i) => {
        if (f.kind === 'city') {
          return (
            <View key={i} style={{ position: 'absolute', left: 0, top: 0, width: size, height: size }}>
              {f.sides.map((sd) => box(rect(sd), CITY, `c${sd}`))}
              {f.sides.length >= 2 && box([0.15, 0.15, 0.7, 0.7], CITY, 'mid')}
              {f.shield && <Text style={{ position: 'absolute', left: featPos(f)[0] * size - size * 0.12, top: featPos(f)[1] * size - size * 0.14, fontSize: size * 0.26 }}>🛡️</Text>}
            </View>
          );
        }
        if (f.kind === 'road') {
          return f.sides.map((sd) => {
            const horizontal = sd === 1 || sd === 3;
            const r: [number, number, number, number] = horizontal ? [sd === 1 ? 0.5 : 0, 0.43, 0.5, 0.14] : [0.43, sd === 2 ? 0.5 : 0, 0.14, 0.5];
            return box(r, ROAD, `r${i}-${sd}`, { borderWidth: 0.5, borderColor: '#9A8A55' });
          });
        }
        if (f.kind === 'monastery') {
          return (
            <View key={i} style={{ position: 'absolute', left: size * 0.3, top: size * 0.3, width: size * 0.4, height: size * 0.4, backgroundColor: '#C0392B', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: size * 0.26 }}>⛪</Text>
            </View>
          );
        }
        return null;
      })}
      {meeples?.map((m, k) => {
        const [px, py] = featPos(feats[m.feat]!);
        const sz = size * 0.3;
        return <View key={`m${k}`} style={{ position: 'absolute', left: px * size - sz / 2, top: py * size - sz / 2, width: sz, height: sz, borderRadius: sz / 2, backgroundColor: PLAYER[m.player], borderWidth: 2, borderColor: '#fff' }} />;
      })}
      {markers?.map((fi) => {
        const [px, py] = featPos(feats[fi]!);
        const sz = Math.max(26, size * 0.18);
        return (
          <Pressable key={`k${fi}`} onPress={() => onMarker?.(fi)} style={{ position: 'absolute', left: px * size - sz / 2, top: py * size - sz / 2, width: sz, height: sz, borderRadius: sz / 2, backgroundColor: 'rgba(255,255,255,0.8)', borderWidth: 2, borderColor: '#E8710A', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 12 }}>{feats[fi]!.kind === 'city' ? '🏰' : feats[fi]!.kind === 'road' ? '🛣️' : feats[fi]!.kind === 'monastery' ? '⛪' : '🌾'}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Каркассон: выложенные плитки на сетке, предпросмотр текущей плитки с поворотом и выбор места для последователя. */
export function CarcassonneBoard({ view, seat, legal, myTurn, onAction, disabled }: GameUIProps<V, A>) {
  const { colors } = useTheme();
  const can = myTurn && !disabled;
  const [rot, setRot] = useState(0);
  const places = useMemo(() => legal.filter((a): a is Extract<A, { t: 'place' }> => a.t === 'place'), [legal]);
  const rots = useMemo(() => new Set(places.map((p) => p.rot)), [places]);
  useEffect(() => {
    if (!rots.has(rot) && rots.size > 0) setRot([...rots].sort()[0]!);
  }, [rots, rot]);

  const xs = view.placed.map((p) => p.x);
  const ys = view.placed.map((p) => p.y);
  const minX = Math.min(...xs) - 1;
  const minY = Math.min(...ys) - 1;
  const w = (Math.max(...xs) + 1 - minX + 1) * CELL;
  const h = (Math.max(...ys) + 1 - minY + 1) * CELL;
  const act = (a: A) => {
    feedback.move();
    onAction(a);
  };
  const lastTile = view.placed[view.last]!;
  const meepleOpts = legal.filter((a): a is Extract<A, { t: 'meeple' }> => a.t === 'meeple').map((a) => a.feat);

  return (
    <ScrollView contentContainerStyle={{ gap: 8, paddingBottom: 24 }}>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        {view.scores.map((sc, p) => (
          <View key={p} style={{ padding: 6, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 2, borderColor: view.turn === p && !view.finished ? PLAYER[p] : colors.border, minWidth: 80 }}>
            <Text style={{ color: colors.text, fontWeight: '800' }}><Text style={{ color: PLAYER[p] }}>●</Text> {p === seat ? 'Вы' : `Игрок ${p + 1}`}</Text>
            <Text style={{ color: colors.text }}>{sc} оч. · 🧍{view.meeplesLeft[p]}</Text>
          </View>
        ))}
      </View>

      <ScrollView horizontal style={{ maxHeight: 360, borderRadius: 10, backgroundColor: '#C9D8B6' }}>
        <ScrollView nestedScrollEnabled>
          <View style={{ width: w, height: h }}>
            {view.placed.map((p, i) => (
              <View key={i} style={{ position: 'absolute', left: (p.x - minX) * CELL, top: (p.y - minY) * CELL, borderWidth: i === view.last ? 2 : 0, borderColor: '#E8710A' }}>
                <TileView type={p.type} rot={p.rot} size={CELL} meeples={view.meeples.filter((m) => m.tile === i)} />
              </View>
            ))}
            {view.phase === 'tile' && can && places.filter((p) => p.rot === rot).map((p) => (
              <Pressable key={`${p.x},${p.y}`} onPress={() => act(p)} style={{ position: 'absolute', left: (p.x - minX) * CELL, top: (p.y - minY) * CELL, width: CELL, height: CELL, opacity: 0.9 }}>
                {view.cur !== null && <TileView type={view.cur} rot={rot} size={CELL} />}
                <View style={{ position: 'absolute', inset: 0, borderWidth: 3, borderColor: '#E8710A', backgroundColor: 'rgba(232,113,10,0.2)' }} />
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </ScrollView>

      {view.phase === 'tile' && view.cur !== null && (
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', justifyContent: 'center' }}>
          <TileView type={view.cur} rot={rot} size={72} />
          <View style={{ gap: 6, flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>{carc.TILE_TYPES[view.cur]!.name}</Text>
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>В колоде: {view.deckCount}</Text>
            {can ? (
              <Button title="Повернуть ↻" variant="secondary" disabled={rots.size < 2} onPress={() => { const list = [...rots].sort(); setRot(list[(list.indexOf(rot) + 1) % list.length]!); }} />
            ) : <Text style={{ color: colors.textMuted }}>Ходит игрок {view.turn + 1}</Text>}
          </View>
        </View>
      )}

      {view.phase === 'meeple' && can && (
        <View style={{ alignItems: 'center', gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: colors.surface }}>
          <Text style={{ color: colors.text, fontWeight: '800' }}>Поставить последователя?</Text>
          <TileView type={lastTile.type} rot={lastTile.rot} size={180} markers={meepleOpts} onMarker={(feat) => act({ t: 'meeple', feat })} />
          <Button title="Без последователя" variant="secondary" onPress={() => act({ t: 'skip' })} />
        </View>
      )}
      {view.finished && view.finalPoints && (
        <Text style={{ color: colors.text, textAlign: 'center' }}>
          Итоговый подсчёт: {view.finalPoints.map((p, i) => `И${i + 1} +${p}`).join(' · ')}
        </Text>
      )}
      <Text numberOfLines={3} style={{ color: colors.textMuted, fontSize: 12 }}>{view.log.slice(-3).join(' ')}</Text>
    </ScrollView>
  );
}
