import { bunker } from '@nastolki/game-engine';
import { ScrollView, Text, View } from 'react-native';
import { Button } from '@/components/ui';
import { feedback } from '@/services/feedback';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import type { GameUIProps } from '../registry';

type V = bunker.BunkerView;
type A = bunker.BunkerAction;

const KEYS: (bunker.Category | 'person')[] = ['person', ...bunker.CATEGORIES];

/** Стол «Бункера»: катастрофа и бункер, карты игроков, раскрытие своей карты, обсуждение и голосование. */
export function BunkerTable({ view, seat, legal, myTurn, onAction, disabled }: GameUIProps<V, A>) {
  const { colors } = useTheme();
  const can = myTurn && !disabled;
  const act = (a: A) => {
    feedback.move();
    onAction(a);
  };
  const reveals = new Set(legal.filter((a): a is Extract<A, { t: 'reveal' }> => a.t === 'reveal').map((a) => a.cat));
  const votes = legal.filter((a): a is Extract<A, { t: 'vote' }> => a.t === 'vote');
  const ready = legal.find((a) => a.t === 'ready');
  const aliveCount = view.alive.filter(Boolean).length;
  const phaseTitle = { reveal: 'Раскрытие карт', discuss: 'Обсуждение', vote: 'Голосование', revote: 'Переголосование' }[view.phase];

  return (
    <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 20 }}>
      <View style={{ padding: 12, borderRadius: radius.lg, backgroundColor: '#3A1F1F' }}>
        <Text style={{ color: '#FFD9C7', fontWeight: '800' }}>☢ Катастрофа</Text>
        <Text style={{ color: '#FFEFE6' }}>{view.catastrophe}</Text>
        <Text style={{ color: '#FFD9C7', fontWeight: '800', marginTop: 6 }}>🏠 Бункер</Text>
        <Text style={{ color: '#FFEFE6' }}>{view.bunker}</Text>
        <Text style={{ color: '#FFD9C7', marginTop: 6 }}>Мест: {view.capacity} · сейчас в игре: {aliveCount}</Text>
      </View>

      <Text style={{ color: colors.text, fontWeight: '800', textAlign: 'center' }}>Раунд {view.round}: {view.finished ? 'игра окончена' : phaseTitle}</Text>

      {view.finished ? (
        <Text style={{ color: colors.text, textAlign: 'center', fontSize: 18, fontWeight: '800' }}>
          {view.alive[seat] ? 'Вы попали в бункер! 🎉' : 'Вас изгнали…'}
        </Text>
      ) : view.phase === 'reveal' ? (
        can ? <Text style={{ color: colors.text }}>Выберите одну из своих карт и раскройте её всем ↓</Text> : <Text style={{ color: colors.textMuted }}>{view.alive[seat] ? 'Вы раскрыли карту — ждём остальных' : 'Вы наблюдаете'}</Text>
      ) : view.phase === 'discuss' ? (
        <View style={{ gap: 6 }}>
          <Text style={{ color: colors.text }}>Обсудите в чате, кто достоин места в бункере.</Text>
          {can && ready && <Button title="Готов голосовать" onPress={() => act(ready)} />}
        </View>
      ) : can ? (
        <View style={{ gap: 6 }}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>Кого изгнать?{view.phase === 'revote' ? ' (ничья — выбирайте из спорных)' : ''}</Text>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {votes.map((v) => <Button key={v.target} title={`Игрок ${v.target + 1}`} variant="secondary" onPress={() => act(v)} />)}
          </View>
        </View>
      ) : <Text style={{ color: colors.textMuted }}>{view.alive[seat] ? 'Ваш голос принят — ждём остальных' : 'Вы выбыли'}</Text>}

      {Array.from({ length: view.players }, (_, i) => (
        <View key={i} style={{ padding: 10, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 2, borderColor: i === seat ? colors.primary : colors.border, opacity: view.alive[i] ? 1 : 0.45, gap: 3 }}>
          <Text style={{ color: colors.text, fontWeight: '800' }}>
            {view.alive[i] ? '' : '🚪 '}Игрок {i + 1}{i === seat ? ' (вы)' : ''}{view.acted[i] && !view.finished ? ' ✓' : ''}
          </Text>
          {KEYS.map((k) => {
            const text = view.cards[i]![k];
            const opened = view.open[i]![k];
            const mine = i === seat;
            const canReveal = mine && can && view.phase === 'reveal' && reveals.has(k);
            return (
              <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ color: colors.textMuted, width: 98, fontSize: 12 }}>{bunker.CATEGORY_TITLES[k]}:</Text>
                <Text style={{ color: opened ? colors.text : mine ? colors.textMuted : colors.border, flex: 1, fontSize: 13, fontStyle: opened ? 'normal' : 'italic' }}>
                  {text ? `${text}${mine && !opened ? ' (скрыто)' : ''}` : '▒▒▒▒▒▒'}
                </Text>
                {canReveal && <Button title="Открыть" variant="secondary" onPress={() => act({ t: 'reveal', cat: k })} />}
              </View>
            );
          })}
        </View>
      ))}

      {[...view.log].slice(-6).reverse().map((l, i) => <Text key={i} style={{ color: i === 0 ? colors.text : colors.textMuted, fontSize: 12 }}>{l}</Text>)}
    </ScrollView>
  );
}
