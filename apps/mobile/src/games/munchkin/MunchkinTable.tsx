import { munchkin as mk } from '@nastolki/game-engine';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Button } from '@/components/ui';
import { feedback } from '@/services/feedback';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import type { GameUIProps } from '../registry';

type V = mk.MunchView;
type A = mk.MunchAction;

const KIND_COLOR: Record<string, string> = { monster: '#B5483C', curse: '#6A3FA0', race: '#2E7D6B', class: '#2F6FED', enhancer: '#A2672D', item: '#8A7A2A', potion: '#2E9D5B', trap: '#7B3F3F', levelup: '#C99700' };
const KIND_ICON: Record<string, string> = { monster: '👹', curse: '☠️', race: '🧝', class: '🛡️', enhancer: '⬆️', item: '🗡️', potion: '🧪', trap: '🪤', levelup: '⭐' };

function describe(c: number): string {
  const d = mk.cardOf(c);
  switch (d.kind) {
    case 'monster': return `ур.${d.level} · ${d.treasures}💰${d.gain > 1 ? ` · +${d.gain} ур.` : ''}${d.undead ? ' · нежить' : ''}`;
    case 'item': return `${d.slot === 'none' ? 'ценность' : d.slot === 'head' ? 'голова' : d.slot === 'body' ? 'тело' : d.slot === 'feet' ? 'ноги' : `руки ×${d.hands ?? 1}`}${d.bonus ? ` +${d.bonus}` : ''}${d.big ? ' · большое' : ''} · ${d.gold}з`;
    case 'potion': return `+${d.bonus} в бою · ${d.gold}з`;
    case 'trap': return `−${d.penalty} герою · ${d.gold}з`;
    case 'enhancer': return `монстр ${d.mod > 0 ? '+' : ''}${d.mod}, сокр. ${d.tmod > 0 ? '+' : ''}${d.tmod}`;
    case 'curse': return 'проклятие';
    case 'race': return 'раса';
    case 'class': return 'класс';
    case 'levelup': return '+1 уровень';
  }
}

function CardChip({ c, selected, onPress, extra }: { c: number; selected?: boolean; onPress?: () => void; extra?: string }) {
  const d = mk.cardOf(c);
  return (
    <Pressable onPress={onPress} style={{ width: 112, minHeight: 72, padding: 6, borderRadius: radius.md, backgroundColor: KIND_COLOR[d.kind], borderWidth: selected ? 3 : 1, borderColor: selected ? '#fff' : '#00000033' }}>
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>{KIND_ICON[d.kind]} {d.name}{extra ?? ''}</Text>
      <Text style={{ color: '#ffffffcc', fontSize: 11 }}>{describe(c)}</Text>
    </Pressable>
  );
}

/** «Манчкин»: стол героев, панель боя, предметы на столе, рука и контекстные действия выбранной карты. */
export function MunchkinTable({ view, seat, legal, myTurn, onAction, disabled }: GameUIProps<V, A>) {
  const { colors } = useTheme();
  const can = !disabled;
  const [picked, setPicked] = useState<number | null>(null);
  const [sellMode, setSellMode] = useState(false);
  const [sell, setSell] = useState<number[]>([]);
  useEffect(() => {
    setPicked(null);
    setSellMode(false);
    setSell([]);
  }, [view.step, view.turn, view.fight?.stage]);
  const act = (a: A) => {
    feedback.move();
    onAction(a);
  };
  const me = view.heroes[seat]!;
  const f = view.fight;
  const has = <T extends A['t']>(t: T) => legal.some((a) => a.t === t);
  const forCard = (c: number) => legal.filter((a) => 'c' in a && a.c === c);
  const freeStep = myTurn && (view.step === 'kick' || view.step === 'after' || view.step === 'wrap');

  const sellable = [...me.items.map((o) => o.c), ...(me.hand ?? []).filter((c) => mk.goldOf(c) > 0 && mk.cardOf(c).kind === 'item')];
  const gold = sell.reduce((a, c) => a + mk.goldOf(c), 0);

  const status = (() => {
    if (view.finished) return view.winner === seat ? '🏆 Вы победили!' : view.winner !== null ? `Победил игрок ${view.winner + 1}` : 'Лимит ходов: побеждает высший уровень';
    if (f) {
      if (f.stage === 'invite') return f.inviteTo === seat ? `Игрок ${f.hero + 1} просит помощи за ${f.reward} сокр.` : `Игрок ${f.hero + 1} просит помощи у игрока ${f.inviteTo + 1}`;
      if (f.stage === 'interfere') return f.queue[0] === seat ? 'Вмешаетесь в бой?' : `Игрок ${f.queue[0]! + 1} решает, вмешиваться ли`;
      if (f.stage === 'run') return f.hero === seat ? 'Вы проигрываете — бегите!' : `Игрок ${f.hero + 1} пытается бежать`;
      return f.hero === seat ? 'Ваш бой: готовьтесь и жмите «В бой»' : `Игрок ${f.hero + 1} готовится к бою`;
    }
    if (view.step === 'charity') return myTurn ? 'Лишние карты: отдайте слабейшему' : `Игрок ${view.turn + 1} раздаёт лишнее`;
    if (!myTurn) return `Ходит игрок ${view.turn + 1}`;
    return view.step === 'kick' ? 'Ваш ход: снарядитесь и откройте дверь' : view.step === 'after' ? 'Ничего не случилось: обыщите комнату или сами найдите бой' : 'Ход окончен — можно ещё снарядиться';
  })();

  return (
    <ScrollView contentContainerStyle={{ gap: 8, paddingBottom: 24 }}>
      <ScrollView horizontal contentContainerStyle={{ gap: 6 }}>
        {view.heroes.map((h, p) => (
          <View key={p} style={{ padding: 6, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 2, borderColor: view.turn === p && !view.finished ? colors.primary : colors.border, minWidth: 118 }}>
            <Text style={{ color: colors.text, fontWeight: '800' }}>{p === seat ? 'Вы' : `Игрок ${p + 1}`}{h.dead ? ' ☠️' : ''}</Text>
            <Text style={{ color: colors.text }}>Ур. {h.level} · сила {h.power}</Text>
            <Text style={{ color: colors.textMuted, fontSize: 11 }}>
              {h.race >= 0 ? mk.cardOf(h.race).name : '—'} / {h.cls >= 0 ? mk.cardOf(h.cls).name : '—'}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 11 }}>🂠{h.handCount} · 🎒{h.items.length}</Text>
          </View>
        ))}
      </ScrollView>

      {f && (
        <View style={{ padding: 10, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, gap: 6 }}>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {f.monsters.map((m, i) => (
              <CardChip key={i} c={m.c} extra={m.mod ? ` (${m.mod > 0 ? '+' : ''}${m.mod})` : ''} />
            ))}
          </View>
          <Text style={{ color: colors.text, fontWeight: '800' }}>
            Герои {view.heroSide} против монстров {view.monsterSide}
            {f.helper >= 0 ? ` · помогает игрок ${f.helper + 1}` : ''}
            {f.roll ? ` · бросок ${f.roll}` : ''}
          </Text>
        </View>
      )}

      <Text style={{ color: colors.text, fontWeight: '700', textAlign: 'center' }}>{status}</Text>

      {/* Кнопки шага */}
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
        {has('kick') && <Button title="🚪 Открыть дверь" disabled={!can} onPress={() => act({ t: 'kick' })} />}
        {has('loot') && <Button title="🔍 Обыскать комнату" variant="secondary" disabled={!can} onPress={() => act({ t: 'loot' })} />}
        {has('end') && <Button title="Закончить ход" disabled={!can} onPress={() => act({ t: 'end' })} />}
        {has('fight') && <Button title="⚔️ В бой" disabled={!can} onPress={() => act({ t: 'fight' })} />}
        {has('flee') && <Button title="🏃 Бежать" disabled={!can} onPress={() => act({ t: 'flee' })} />}
        {has('accept') && <Button title="Помочь" disabled={!can} onPress={() => act({ t: 'accept' })} />}
        {has('decline') && <Button title="Отказать" variant="secondary" disabled={!can} onPress={() => act({ t: 'decline' })} />}
        {has('pass') && <Button title="Не вмешиваться" variant="secondary" disabled={!can} onPress={() => act({ t: 'pass' })} />}
        {legal.find((a) => a.t === 'charity') && <Button title="Отдать лишнее" disabled={!can} onPress={() => act(legal.find((a) => a.t === 'charity')!)} />}
        {legal.find((a) => a.t === 'flight') && <Button title="✨ Улететь (маг)" variant="secondary" disabled={!can} onPress={() => act(legal.find((a) => a.t === 'flight')!)} />}
        {legal.find((a) => a.t === 'berserk') && <Button title="💢 Ярость (−1 карта, +1)" variant="secondary" disabled={!can} onPress={() => act(legal.find((a) => a.t === 'berserk')!)} />}
        {freeStep && <Button title={sellMode ? 'Отмена продажи' : '💰 Продать'} variant="secondary" onPress={() => { setSellMode(!sellMode); setSell([]); }} />}
      </View>

      {/* Приглашение помощника */}
      {f?.stage === 'combat' && f.hero === seat && f.helper < 0 && has('invite') && (
        <View style={{ gap: 4 }}>
          <Text style={{ color: colors.textMuted, textAlign: 'center', fontSize: 12 }}>Позвать на помощь (с долей сокровищ):</Text>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
            {view.heroes.map((_, p) => {
              if (p === seat) return null;
              const opts = legal.filter((a): a is Extract<A, { t: 'invite' }> => a.t === 'invite' && a.to === p);
              if (opts.length === 0) return null;
              const best = opts[Math.min(1, opts.length - 1)]!;
              return <Button key={p} title={`Игрок ${p + 1}: ${best.treasures} сокр.`} variant="secondary" disabled={!can} onPress={() => act(best)} />;
            })}
          </View>
        </View>
      )}

      {sellMode && (
        <View style={{ padding: 8, borderRadius: radius.md, backgroundColor: colors.surface, gap: 6 }}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>Выберите вещи: {gold}/1000 золотых</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {sellable.map((c, i) => {
              const chosenCount = sell.filter((x) => x === c).length;
              const idx = sellable.slice(0, i).filter((x) => x === c).length;
              return <CardChip key={i} c={c} selected={idx < chosenCount} onPress={() => setSell(idx < chosenCount ? sell.filter((_, k) => k !== sell.indexOf(c)) : [...sell, c])} />;
            })}
          </View>
          <Button title="Продать" disabled={gold < 1000} onPress={() => act({ t: 'sell', items: sell })} />
        </View>
      )}

      {/* Предметы на столе */}
      <Text style={{ color: colors.text, fontWeight: '700' }}>На столе (сила +{view.heroes[seat]!.items.reduce((a, o) => a + (o.eq ? (mk.cardOf(o.c) as { bonus: number }).bonus : 0), 0)})</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {me.items.map((o, i) => (
          <CardChip
            key={i}
            c={o.c}
            extra={o.eq ? ' ✓' : ''}
            selected={o.eq}
            onPress={myTurn && freeStep && can ? () => act(o.eq ? { t: 'unequip', c: o.c } : { t: 'equip', c: o.c }) : undefined}
          />
        ))}
        {me.items.length === 0 && <Text style={{ color: colors.textMuted }}>пусто</Text>}
      </View>
      <Text style={{ color: colors.textMuted, fontSize: 11 }}>Нажмите на предмет, чтобы надеть или снять.</Text>

      {/* Рука */}
      <Text style={{ color: colors.text, fontWeight: '700' }}>Рука ({me.hand?.length ?? 0}/{mk.HAND_LIMIT})</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {(me.hand ?? []).map((c, i) => (
          <CardChip key={i} c={c} selected={picked === i} onPress={() => setPicked(picked === i ? null : i)} />
        ))}
      </View>
      {picked !== null && me.hand?.[picked] !== undefined && (
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {forCard(me.hand[picked]!).length === 0 && <Text style={{ color: colors.textMuted }}>Сейчас эту карту сыграть нельзя.</Text>}
          {forCard(me.hand[picked]!).map((a, k) => (
            <Button
              key={k}
              title={
                a.t === 'curse' ? `Проклясть игрока ${a.target + 1}`
                  : a.t === 'equip' ? 'Выложить и надеть'
                  : a.t === 'race' ? 'Стать этой расой'
                  : a.t === 'cls' ? 'Взять класс'
                  : a.t === 'levelup' ? 'Получить уровень'
                  : a.t === 'trouble' ? 'Напасть на монстра'
                  : a.t === 'potion' ? 'Выпить'
                  : a.t === 'enhance' ? 'Усилить монстра'
                  : a.t === 'hinder' ? 'Помешать герою'
                  : a.t === 'backstab' ? 'Удар в спину' : 'Сыграть'
              }
              variant="secondary"
              disabled={!can}
              onPress={() => act(a)}
            />
          ))}
        </View>
      )}
      <Text numberOfLines={3} style={{ color: colors.textMuted, fontSize: 12 }}>{view.log.slice(-3).join(' ')}</Text>
    </ScrollView>
  );
}
