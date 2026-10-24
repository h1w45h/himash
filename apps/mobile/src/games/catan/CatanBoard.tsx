import { catan } from '@nastolki/game-engine';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { Button } from '@/components/ui';
import { feedback } from '@/services/feedback';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import type { GameUIProps } from '../registry';

type V = catan.CatanView;
type A = catan.CatanAction;
type Mode = 'road' | 'settlement' | 'city' | null;

const PLAYER = ['#E5484D', '#2F6FED', '#F2F2F2', '#F2A413'];
const PLAYER_EDGE = ['#8F1D21', '#173F96', '#888', '#9A6500'];
const RES_COLOR = ['#2E7D32', '#C0562B', '#9CCC65', '#F2C94C', '#7B8794'];
const RES_ICON = ['🌲', '🧱', '🐑', '🌾', '⛏️'];
const DEV_ICON = ['⚔️', '🛣️', '🎁', '💰', '🏆'];
const DESERT = '#E0CDA0';

/** Шестиугольник из трёх повёрнутых прямоугольников (SVG в проекте не используется). */
function Hexagon({ cx, cy, R, color }: { cx: number; cy: number; R: number; color: string }) {
  const w = Math.sqrt(3) * R;
  return (
    <>
      {[0, 60, 120].map((deg) => (
        <View key={deg} style={{ position: 'absolute', left: cx - w / 2, top: cy - R / 2, width: w + 0.6, height: R + 0.6, backgroundColor: color, transform: [{ rotate: `${deg}deg` }] }} />
      ))}
    </>
  );
}

function Counter({ label, n, max, onChange }: { label: string; n: number; max: number; onChange: (n: number) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', width: 52 }}>
      <Text style={{ fontSize: 20 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Pressable onPress={() => onChange(Math.max(0, n - 1))}><Text style={{ color: colors.primary, fontSize: 22, fontWeight: '800' }}>−</Text></Pressable>
        <Text style={{ color: colors.text, fontWeight: '800', minWidth: 14, textAlign: 'center' }}>{n}</Text>
        <Pressable onPress={() => onChange(Math.min(max, n + 1))}><Text style={{ color: colors.primary, fontSize: 22, fontWeight: '800' }}>+</Text></Pressable>
      </View>
    </View>
  );
}

/** «Колонизаторы»: поле из шестиугольников, панель действий (стройка, карты, обмен) и ресурсы на руке. */
export function CatanBoard({ view, seat, legal, myTurn, onAction, disabled }: GameUIProps<V, A>) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const W = Math.min(width - 16, 560);
  const R = W / 9.6;
  const H = R * 8.6;
  const cx = W / 2;
  const cy = H / 2;
  const can = !disabled;
  const [mode, setMode] = useState<Mode>(null);
  const [panel, setPanel] = useState<null | 'bank' | 'offer' | 'dev'>(null);
  const [give, setGive] = useState([0, 0, 0, 0, 0]);
  const [get, setGet] = useState([0, 0, 0, 0, 0]);
  const [bankGive, setBankGive] = useState<number | null>(null);
  const [discard, setDiscard] = useState([0, 0, 0, 0, 0]);
  useEffect(() => {
    setMode(null);
    setPanel(null);
    setDiscard([0, 0, 0, 0, 0]);
  }, [view.phase, view.turn, view.rolled]);

  const act = (a: A) => {
    feedback.move();
    onAction(a);
  };
  const find = <T extends A['t']>(t: T) => legal.filter((a): a is Extract<A, { t: T }> => a.t === t);
  const builds = find('build');
  const spots = (what: 'road' | 'settlement' | 'city') => new Set(builds.filter((b) => b.what === what).map((b) => b.at));
  const active: Mode = view.phase === 'setup' ? (view.setupStep === 'road' ? 'road' : 'settlement') : view.phase === 'roads' ? 'road' : mode;
  const activeSpots = active ? spots(active) : new Set<number>();
  const hand = view.hand ?? [0, 0, 0, 0, 0];
  const mine = view.turn === seat;
  const robberMoves = new Set(find('moveRobber').map((a) => a.hex));

  const vpos = (v: number) => ({ x: cx + catan.BOARD.verts[v]!.x * R, y: cy + catan.BOARD.verts[v]!.y * R });

  const header = (
    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
      {view.vp.map((vp, p) => (
        <View key={p} style={{ padding: 6, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 2, borderColor: view.turn === p && !view.finished ? PLAYER[p] : colors.border, minWidth: 84 }}>
          <Text style={{ color: colors.text, fontWeight: '800' }}><Text style={{ color: PLAYER[p] }}>●</Text> {p === seat ? 'Вы' : `Игрок ${p + 1}`}: {p === seat ? view.myVp : vp}★</Text>
          <Text style={{ color: colors.textMuted, fontSize: 11 }}>
            🂠{view.handCounts[p]} · 📜{view.devCounts[p]} · ⚔️{view.knights[p]} · 🛣️{view.roadLens[p]}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 10 }}>
            {view.longest.holder === p ? '🛣️ длинная дорога ' : ''}{view.army === p ? '⚔️ войско' : ''}
          </Text>
        </View>
      ))}
    </View>
  );

  const status = (() => {
    if (view.finished) return view.winner === seat ? '🏆 Вы победили!' : `Победил игрок ${view.winner! + 1}`;
    if (view.phase === 'discard') return view.discardNeed[seat]! > 0 ? `Выпала семёрка: сбросьте ${view.discardNeed[seat]} карт` : 'Игроки сбрасывают карты…';
    if (view.offer && view.offer.from !== seat && view.offer.responses[seat] === 0) return `Игрок ${view.offer.from + 1} предлагает обмен`;
    if (!mine) return `Ходит игрок ${view.turn + 1}`;
    switch (view.phase) {
      case 'setup': return view.setupStep === 'settlement' ? 'Поставьте поселение' : 'Проложите дорогу от нового поселения';
      case 'roll': return 'Бросьте кости';
      case 'robber': return 'Переставьте разбойника на другой гекс';
      case 'steal': return 'Выберите, у кого украсть карту';
      case 'roads': return `Постройте бесплатную дорогу (осталось ${view.freeRoads})`;
      default: return 'Ваш ход';
    }
  })();

  return (
    <ScrollView contentContainerStyle={{ gap: 8, paddingBottom: 24 }}>
      {header}
      <View style={{ width: W, height: H, alignSelf: 'center', backgroundColor: '#3E8DB5', borderRadius: 14, overflow: 'hidden' }}>
        {catan.BOARD.hexes.map((h, i) => {
          const x = cx + h.x * R;
          const y = cy + h.y * R;
          const res = view.hexRes[i]!;
          return (
            <View key={i}>
              <Hexagon cx={x} cy={y} R={R * 0.97} color={res < 0 ? DESERT : RES_COLOR[res]!} />
              <Text style={{ position: 'absolute', left: x - 14, top: y - R * 0.78, width: 28, textAlign: 'center', fontSize: R * 0.34 }}>{res < 0 ? '🏜️' : RES_ICON[res]}</Text>
              {view.hexNum[i]! > 0 && (
                <View style={{ position: 'absolute', left: x - R * 0.3, top: y - R * 0.3 + R * 0.12, width: R * 0.6, height: R * 0.6, borderRadius: R * 0.3, backgroundColor: '#F7EFD8', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontWeight: '900', fontSize: R * 0.3, color: view.hexNum[i] === 6 || view.hexNum[i] === 8 ? '#C62828' : '#222' }}>{view.hexNum[i]}</Text>
                </View>
              )}
              {view.robber === i && (
                <View style={{ position: 'absolute', left: x - R * 0.2, top: y - R * 0.62, width: R * 0.4, height: R * 0.55, borderRadius: R * 0.2, backgroundColor: '#222', borderWidth: 2, borderColor: '#fff' }} />
              )}
              {robberMoves.has(i) && mine && can && (
                <Pressable onPress={() => act({ t: 'moveRobber', hex: i })} style={{ position: 'absolute', left: x - R * 0.7, top: y - R * 0.7, width: R * 1.4, height: R * 1.4, borderRadius: R * 0.7, backgroundColor: 'rgba(232,113,10,0.35)', borderWidth: 2, borderColor: '#E8710A' }} />
              )}
            </View>
          );
        })}

        {catan.BOARD.portEdges.map((e, slot) => {
          const ed = catan.BOARD.edges[e]!;
          const a = vpos(ed.a);
          const b = vpos(ed.b);
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          const dx = mx - cx;
          const dy = my - cy;
          const d = Math.hypot(dx, dy) || 1;
          const type = view.ports[slot]!;
          return (
            <View key={`p${slot}`} style={{ position: 'absolute', left: mx + (dx / d) * R * 0.45 - 20, top: my + (dy / d) * R * 0.45 - 10, width: 40, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontSize: R * 0.2, fontWeight: '800' }}>{type === catan.GENERIC_PORT ? '3:1' : `2:1 ${RES_ICON[type]}`}</Text>
            </View>
          );
        })}

        {catan.BOARD.edges.map((ed, e) => {
          const a = vpos(ed.a);
          const b = vpos(ed.b);
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy);
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          const owner = view.eOwner[e]!;
          return (
            <View key={`e${e}`}>
              {owner >= 0 && (
                <View style={{ position: 'absolute', left: mx - len * 0.42, top: my - 4, width: len * 0.84, height: 8, borderRadius: 3, backgroundColor: PLAYER[owner], borderWidth: 1.5, borderColor: PLAYER_EDGE[owner], transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }] }} />
              )}
              {owner < 0 && activeSpots.has(e) && active === 'road' && mine && can && (
                <Pressable onPress={() => act({ t: 'build', what: 'road', at: e })} style={{ position: 'absolute', left: mx - 14, top: my - 14, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.6)', borderWidth: 2, borderColor: '#E8710A' }} />
              )}
            </View>
          );
        })}

        {catan.BOARD.verts.map((_, v) => {
          const { x, y } = vpos(v);
          const owner = view.vOwner[v]!;
          const kind = view.vKind[v]!;
          const open = kind === 0 ? active === 'settlement' && activeSpots.has(v) : active === 'city' && activeSpots.has(v);
          const size = kind === 2 ? R * 0.5 : R * 0.36;
          return (
            <View key={`v${v}`}>
              {owner >= 0 && (
                <View style={{ position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size, borderRadius: kind === 2 ? 4 : size / 2, backgroundColor: PLAYER[owner], borderWidth: 2, borderColor: PLAYER_EDGE[owner], alignItems: 'center', justifyContent: 'center' }}>
                  {kind === 2 && <Text style={{ fontSize: size * 0.6 }}>🏛️</Text>}
                </View>
              )}
              {open && mine && can && (
                <Pressable onPress={() => act({ t: 'build', what: kind === 0 ? 'settlement' : 'city', at: v })} style={{ position: 'absolute', left: x - 15, top: y - 15, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.65)', borderWidth: 2, borderColor: '#E8710A' }} />
              )}
            </View>
          );
        })}
      </View>

      <Text style={{ color: colors.text, fontWeight: '700', textAlign: 'center' }}>
        {status}{view.dice ? `  ·  🎲 ${view.dice[0]} + ${view.dice[1]} = ${view.dice[0] + view.dice[1]}` : ''}
      </Text>

      {/* Свои ресурсы и карты развития */}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        {hand.map((n, r) => (
          <View key={r} style={{ minWidth: 48, alignItems: 'center', padding: 6, borderRadius: radius.md, backgroundColor: RES_COLOR[r], opacity: n ? 1 : 0.4 }}>
            <Text style={{ fontSize: 20 }}>{RES_ICON[r]}</Text>
            <Text style={{ color: '#fff', fontWeight: '900' }}>{n}</Text>
          </View>
        ))}
      </View>
      {view.myDev && view.myDev.some((n) => n > 0) && (
        <Text style={{ color: colors.textMuted, textAlign: 'center', fontSize: 12 }}>
          Карты развития: {view.myDev.map((n, k) => (n > 0 ? `${DEV_ICON[k]} ${catan.DEV[k]} ×${n}` : '')).filter(Boolean).join(' · ')}
        </Text>
      )}

      {/* Сброс при семёрке */}
      {view.phase === 'discard' && view.discardNeed[seat]! > 0 && (
        <View style={{ padding: 10, borderRadius: radius.md, backgroundColor: colors.surface, gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
            {hand.map((n, r) => <Counter key={r} label={RES_ICON[r]!} n={discard[r]!} max={n} onChange={(x) => setDiscard(discard.map((d, i) => (i === r ? x : d)))} />)}
          </View>
          <Button title={`Сбросить (${discard.reduce((a, b) => a + b, 0)}/${view.discardNeed[seat]})`} disabled={discard.reduce((a, b) => a + b, 0) !== view.discardNeed[seat] || !can} onPress={() => act({ t: 'discard', cards: discard })} />
        </View>
      )}

      {/* Выбор жертвы разбойника */}
      {view.phase === 'steal' && mine && (
        <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center' }}>
          {find('steal').map((a) => <Button key={a.from} title={`Украсть у игрока ${a.from + 1}`} variant="secondary" disabled={!can} onPress={() => act(a)} />)}
        </View>
      )}

      {/* Входящее предложение обмена */}
      {view.offer && view.offer.from !== seat && view.offer.responses[seat] === 0 && (
        <View style={{ padding: 10, borderRadius: radius.md, borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.surface, gap: 6 }}>
          <Text style={{ color: colors.text, fontWeight: '800' }}>
            Игрок {view.offer.from + 1} отдаёт {view.offer.give.map((n, r) => (n ? `${n}${RES_ICON[r]}` : '')).join(' ')} за {view.offer.get.map((n, r) => (n ? `${n}${RES_ICON[r]}` : '')).join(' ')}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {legal.some((a) => a.t === 'respond' && a.accept) && <Button title="Принять" disabled={!can} onPress={() => act({ t: 'respond', accept: true })} />}
            <Button title="Отказать" variant="secondary" disabled={!can} onPress={() => act({ t: 'respond', accept: false })} />
          </View>
        </View>
      )}
      {/* Моё предложение: кто согласился */}
      {view.offer && view.offer.from === seat && (
        <View style={{ padding: 10, borderRadius: radius.md, borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.surface, gap: 6 }}>
          <Text style={{ color: colors.text, fontWeight: '800' }}>Ваше предложение ждёт ответов</Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {find('confirm').map((a) => <Button key={a.with} title={`Обменяться с игроком ${a.with + 1}`} disabled={!can} onPress={() => act(a)} />)}
            <Button title="Отозвать" variant="secondary" disabled={!can} onPress={() => act({ t: 'cancel' })} />
          </View>
        </View>
      )}

      {/* Кубики и действия хода */}
      {mine && !view.offer && view.phase === 'roll' && (
        <View style={{ gap: 6 }}>
          <Button title="🎲 Бросить кости" disabled={!can} onPress={() => act({ t: 'roll' })} />
          {find('playKnight')[0] && <Button title="⚔️ Сыграть рыцаря до броска" variant="secondary" disabled={!can} onPress={() => act({ t: 'playKnight' })} />}
        </View>
      )}

      {mine && !view.offer && view.phase === 'main' && (
        <>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
            {([['road', '🛣️ Дорога'], ['settlement', '🏠 Поселение'], ['city', '🏛️ Город']] as const).map(([m, label]) => {
              const enabled = spots(m).size > 0;
              return <Button key={m} title={label} variant={mode === m ? 'primary' : 'secondary'} disabled={!enabled || !can} onPress={() => { setPanel(null); setMode(mode === m ? null : m); }} />;
            })}
            <Button title="📜 Карта" variant="secondary" disabled={!find('buyDev')[0] || !can} onPress={() => act({ t: 'buyDev' })} />
          </View>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Button title="🏦 Банк" variant={panel === 'bank' ? 'primary' : 'secondary'} onPress={() => { setMode(null); setPanel(panel === 'bank' ? null : 'bank'); }} />
            <Button title="🤝 Обмен" variant={panel === 'offer' ? 'primary' : 'secondary'} disabled={view.offersLeft <= 0} onPress={() => { setMode(null); setPanel(panel === 'offer' ? null : 'offer'); }} />
            <Button title="🃏 Играть карту" variant={panel === 'dev' ? 'primary' : 'secondary'} disabled={!legal.some((a) => a.t.startsWith('play'))} onPress={() => { setMode(null); setPanel(panel === 'dev' ? null : 'dev'); }} />
            <Button title="Конец хода" disabled={!can} onPress={() => act({ t: 'end' })} />
          </View>

          {panel === 'bank' && (
            <View style={{ padding: 10, borderRadius: radius.md, backgroundColor: colors.surface, gap: 8 }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>{bankGive === null ? 'Что отдаём?' : `Отдаём ${catan.tradeRatio(view as any, seat, bankGive)} ${RES_ICON[bankGive]} — что получаем?`}</Text>
              <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center' }}>
                {RES_ICON.map((ic, r) => {
                  const ok = bankGive === null ? find('bank').some((a) => a.give === r) : find('bank').some((a) => a.give === bankGive && a.get === r);
                  return (
                    <Pressable key={r} disabled={!ok || !can} onPress={() => { if (bankGive === null) setBankGive(r); else { act({ t: 'bank', give: bankGive, get: r }); setBankGive(null); } }} style={{ padding: 10, borderRadius: radius.md, backgroundColor: RES_COLOR[r], opacity: ok ? 1 : 0.3 }}>
                      <Text style={{ fontSize: 22 }}>{ic}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {bankGive !== null && <Button title="Отмена" variant="secondary" onPress={() => setBankGive(null)} />}
            </View>
          )}

          {panel === 'offer' && (
            <View style={{ padding: 10, borderRadius: radius.md, backgroundColor: colors.surface, gap: 8 }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Отдаю</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 4 }}>
                {RES_ICON.map((ic, r) => <Counter key={r} label={ic} n={give[r]!} max={hand[r]!} onChange={(x) => setGive(give.map((g, i) => (i === r ? x : g)))} />)}
              </View>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Хочу получить</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 4 }}>
                {RES_ICON.map((ic, r) => <Counter key={r} label={ic} n={get[r]!} max={9} onChange={(x) => setGet(get.map((g, i) => (i === r ? x : g)))} />)}
              </View>
              <Button
                title={`Предложить всем (осталось ${view.offersLeft})`}
                disabled={!can || give.every((x) => !x) || get.every((x) => !x) || give.some((g, i) => g > 0 && get[i]! > 0)}
                onPress={() => { act({ t: 'offer', give, get }); setGive([0, 0, 0, 0, 0]); setGet([0, 0, 0, 0, 0]); }}
              />
            </View>
          )}

          {panel === 'dev' && (
            <View style={{ padding: 10, borderRadius: radius.md, backgroundColor: colors.surface, gap: 8 }}>
              {find('playKnight')[0] && <Button title="⚔️ Рыцарь" variant="secondary" onPress={() => act({ t: 'playKnight' })} />}
              {find('playRoads')[0] && <Button title="🛣️ Строительство дорог" variant="secondary" onPress={() => act({ t: 'playRoads' })} />}
              {find('playPlenty')[0] && (
                <>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>🎁 Изобилие — два ресурса из банка</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {find('playPlenty').map((a) => <Pressable key={`${a.a}${a.b}`} onPress={() => act(a)} style={{ padding: 6, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}><Text style={{ fontSize: 18 }}>{RES_ICON[a.a]}{RES_ICON[a.b]}</Text></Pressable>)}
                  </View>
                </>
              )}
              {find('playMonopoly')[0] && (
                <>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>💰 Монополия — забрать ресурс у всех</Text>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {find('playMonopoly').map((a) => <Pressable key={a.res} onPress={() => act(a)} style={{ padding: 8, borderRadius: radius.md, backgroundColor: RES_COLOR[a.res] }}><Text style={{ fontSize: 20 }}>{RES_ICON[a.res]}</Text></Pressable>)}
                  </View>
                </>
              )}
            </View>
          )}
        </>
      )}
      <Text numberOfLines={3} style={{ color: colors.textMuted, fontSize: 12 }}>{view.log.slice(-3).join(' ')}</Text>
    </ScrollView>
  );
}
