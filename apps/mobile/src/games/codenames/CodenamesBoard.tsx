import { codenames } from '@nastolki/game-engine';
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Button, ErrorText } from '@/components/ui';
import { feedback } from '@/services/feedback';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import type { GameUIProps } from '../registry';

type V = codenames.CodenamesView;
type A = codenames.CodenamesAction;

const CARD_BG: Record<string, string> = { red: '#D7263D', blue: '#2B59C3', neutral: '#CDBF9C', assassin: '#1B1A17' };
const TEAM_COLOR = ['#D7263D', '#2B59C3'];

/** Игровое поле «Кодовых имён»: 25 слов, подсказка капитана, выбор слова оперативниками. */
export function CodenamesBoard({ view, seat, legal, myTurn, onAction, disabled }: GameUIProps<V, A>) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const W = Math.min(width - 24, 520);
  const cw = (W - 4 * 6) / 5;
  const [pick, setPick] = useState<number | null>(null);
  const [word, setWord] = useState('');
  const [num, setNum] = useState(1);
  const [err, setErr] = useState<string | null>(null);
  const can = myTurn && !disabled;

  useEffect(() => {
    setPick(null);
    setWord('');
    setErr(null);
  }, [view.log.length]);

  const endTurn = legal.find((a) => a.t === 'endTurn');
  const guessable = new Set(legal.filter((a): a is Extract<A, { t: 'guess' }> => a.t === 'guess').map((a) => a.idx));
  const teamName = codenames.TEAM_NAMES[view.turn];
  const clueTurn = can && view.phase === 'clue' && view.spymaster;

  const tap = (i: number) => {
    if (!can || view.phase !== 'guess' || !guessable.has(i)) return;
    if (pick === i) {
      feedback.move();
      onAction({ t: 'guess', idx: i });
      setPick(null);
    } else {
      feedback.tap();
      setPick(i);
    }
  };

  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      <View style={{ flexDirection: 'row', gap: 20 }}>
        <Text style={{ color: TEAM_COLOR[0], fontWeight: '800', fontSize: 18 }}>Красные: {view.remaining[0]}</Text>
        <Text style={{ color: TEAM_COLOR[1], fontWeight: '800', fontSize: 18 }}>Синие: {view.remaining[1]}</Text>
      </View>

      <View style={{ width: W, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {view.words.map((w, i) => {
          const card = view.key[i];
          const open = view.revealed[i];
          return (
            <Pressable
              key={i}
              onPress={() => tap(i)}
              style={{
                width: cw, height: cw * 0.7, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2,
                backgroundColor: open && card ? CARD_BG[card] : '#F4EFE0',
                borderWidth: pick === i ? 3 : view.spymaster && card && !open ? 3 : 1,
                borderColor: pick === i ? '#E8710A' : view.spymaster && card && !open ? CARD_BG[card] : '#C9C2AD',
                opacity: open ? 0.9 : 1,
              }}
            >
              <Text adjustsFontSizeToFit numberOfLines={1} style={{ fontSize: 12, fontWeight: '700', color: open ? (card === 'neutral' ? '#3B3320' : '#fff') : '#1B1A17' }}>
                {w}
              </Text>
              {open && card === 'assassin' && <Text style={{ fontSize: 10 }}>☠️</Text>}
            </Pressable>
          );
        })}
      </View>

      <View style={{ width: W, padding: 10, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 2, borderColor: view.finished ? colors.border : TEAM_COLOR[view.turn] }}>
        {view.finished ? (
          <Text style={{ color: colors.text, fontWeight: '800', textAlign: 'center' }}>
            Победили {codenames.TEAM_NAMES[view.winner ?? 0].toLowerCase()}{view.reason === 'assassin' ? ' (соперник открыл убийцу)' : ''}
          </Text>
        ) : view.phase === 'clue' ? (
          <Text style={{ color: colors.text }}>{teamName}: капитан придумывает подсказку…</Text>
        ) : (
          <Text style={{ color: colors.text, fontWeight: '700' }}>
            {teamName}: «{view.clue?.word}» — {view.clue?.number === 0 ? '∞' : view.clue?.number} (открыто слов: {view.guesses})
          </Text>
        )}
      </View>

      {clueTurn && (
        <View style={{ width: W, gap: 8 }}>
          <TextInput
            value={word}
            onChangeText={setWord}
            placeholder="Подсказка — одно слово"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            style={{ height: 46, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: 12, fontSize: 16 }}
          />
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {[0, 1, 2, 3, 4, 5].map((n) => <Button key={n} title={n === 0 ? '∞' : String(n)} variant={num === n ? 'primary' : 'secondary'} onPress={() => setNum(n)} />)}
          </View>
          <ErrorText>{err}</ErrorText>
          <Button
            title="Дать подсказку"
            disabled={word.trim().length < 2}
            onPress={() => {
              const a: A = { t: 'clue', word: word.trim(), number: num };
              setErr(null);
              onAction(a);
            }}
          />
        </View>
      )}
      {can && view.phase === 'guess' && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Text style={{ color: colors.textMuted, flex: 1 }}>{pick === null ? 'Коснитесь слова, затем ещё раз — для подтверждения' : `Подтвердите: «${view.words[pick]}»`}</Text>
          {endTurn && <Button title="Закончить ход" variant="secondary" onPress={() => onAction(endTurn)} />}
        </View>
      )}
      {!can && !view.finished && (
        <Text style={{ color: colors.textMuted }}>{view.spymaster ? 'Вы капитан: пока ход другой команды.' : view.myTeam === view.turn && view.phase === 'guess' ? 'Обсудите в чате и выберите слово' : 'Ждём ход…'}</Text>
      )}
      <Text style={{ color: colors.textMuted, fontSize: 12, width: W }} numberOfLines={3}>{view.log.slice(-3).join(' ')}</Text>
    </View>
  );
}
