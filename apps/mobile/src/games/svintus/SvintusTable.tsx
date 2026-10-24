import { svintus } from '@nastolki/game-engine';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Button } from '@/components/ui';
import { feedback } from '@/services/feedback';
import { useSettings } from '@/stores/settings';
import { cardBackColor } from '@/theme/cosmetics';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import type { GameUIProps } from '../registry';

type V = svintus.SvintusView;
type A = svintus.SvintusAction;

const ANIMALS = ['🐷', '🐮', '🐴', '🐑', '🐔', '🦆'];
const TINT = ['#F8D7DA', '#D6EAF8', '#FCF3CF', '#D5F5E3', '#E8DAEF', '#FDEBD0'];

/** Стол «Свинтуса»: четыре карты в руке, одновременная передача и большой «Пятачок». */
export function SvintusTable({ view, seat, legal, myTurn, onAction, disabled }: GameUIProps<V, A>) {
  const { colors } = useTheme();
  const back = cardBackColor(useSettings((s) => s.cardBack));
  const can = myTurn && !disabled;
  const snout = legal.find((a) => a.t === 'snout');
  const race = view.phase === 'race';
  const chosen = view.chosen[seat];
  const others = Array.from({ length: view.players }, (_, i) => i).filter((i) => i !== seat);

  return (
    <View style={{ flex: 1, gap: 12 }}>
      <Text style={{ color: colors.textMuted, textAlign: 'center' }}>Раунд {view.round} · зверей в колоде: {view.kinds}</Text>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
        {others.map((o) => (
          <View key={o} style={{ padding: 8, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 2, borderColor: race && view.race.includes(o) ? colors.danger : colors.border, opacity: view.out[o] ? 0.35 : 1, minWidth: 96 }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>Игрок {o + 1}</Text>
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>{view.out[o] ? 'вылетел' : race ? (view.race.includes(o) ? '👃 нажал' : '…') : view.chosen[o] ? '✓ выбрал' : 'думает…'}</Text>
            <Text style={{ color: colors.danger, letterSpacing: 2, fontWeight: '800' }}>{svintus.WORD.slice(0, view.letters[o] ?? 0) || '—'}</Text>
          </View>
        ))}
      </View>

      <View style={{ alignItems: 'center' }}>
        <Text style={{ color: colors.textMuted, fontSize: 12 }}>Ваши буквы</Text>
        <Text style={{ color: colors.danger, letterSpacing: 3, fontWeight: '900', fontSize: 20 }}>{svintus.WORD.slice(0, view.letters[seat] ?? 0) || '—'}</Text>
      </View>

      {race && <Text style={{ color: colors.danger, textAlign: 'center', fontSize: 20, fontWeight: '900' }}>🚨 ПЯТАЧОК! Жмите скорее!</Text>}

      <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center' }}>
        {view.hand.map((rank, i) => (
          <Animated.View key={`${i}-${rank}-${view.round}`} entering={FadeIn.duration(180)}>
            <Pressable
              disabled={!can || race || !!chosen}
              onPress={() => {
                feedback.move();
                onAction({ t: 'pass', rank });
              }}
              style={{ width: 70, height: 100, borderRadius: 10, backgroundColor: TINT[rank % TINT.length], borderWidth: 3, borderColor: back, alignItems: 'center', justifyContent: 'center', opacity: chosen ? 0.5 : 1 }}
            >
              <Text style={{ fontSize: 40 }}>{ANIMALS[rank % ANIMALS.length]}</Text>
            </Pressable>
          </Animated.View>
        ))}
      </View>

      <Text style={{ color: colors.text, textAlign: 'center', fontWeight: '600' }}>
        {view.finished ? (view.winner === seat ? 'Вы победили! 🏆' : `Победил игрок ${(view.winner ?? 0) + 1}`)
          : view.out[seat] ? 'Вы вылетели'
          : race ? (view.race.includes(seat) ? 'Вы нажали — ждём остальных' : 'Нажмите на пятачок!')
          : chosen ? 'Карта выбрана — ждём остальных' : 'Нажмите на карту, чтобы передать её соседу слева'}
      </Text>

      {snout && (
        <Pressable onPress={() => { feedback.win(); onAction(snout); }} style={{ alignSelf: 'center', paddingHorizontal: 36, paddingVertical: 18, borderRadius: 60, backgroundColor: race ? colors.danger : colors.primary }}>
          <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900' }}>👃 ПЯТАЧОК</Text>
        </Pressable>
      )}
      {!snout && !can && !view.finished && <Button title=" " variant="secondary" onPress={() => {}} disabled />}
    </View>
  );
}
