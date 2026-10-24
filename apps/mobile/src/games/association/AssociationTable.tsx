import { association } from '@nastolki/game-engine';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/ui';
import { feedback } from '@/services/feedback';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import type { GameUIProps } from '../registry';
import { cardArt } from './art';

type V = association.AssocView;
type A = association.AssocAction;

function ArtCard({ deck, id, w = 92, selected, dim, badge }: { deck: string; id: number; w?: number; selected?: boolean; dim?: boolean; badge?: string }) {
  const art = cardArt(deck, id);
  return (
    <View style={{ width: w, height: w * 1.45, borderRadius: 12, overflow: 'hidden', borderWidth: selected ? 4 : 2, borderColor: selected ? '#E8710A' : '#F5F1E6', opacity: dim ? 0.5 : 1, backgroundColor: art.bg[0] }}>
      <View style={{ position: 'absolute', right: -w * 0.3, bottom: -w * 0.3, width: w * 1.1, height: w * 1.1, borderRadius: w, backgroundColor: art.bg[1], opacity: 0.8 }} />
      <Text style={{ position: 'absolute', top: w * 0.08, left: w * 0.1, fontSize: w * 0.42, transform: [{ rotate: `${art.rotation[0]}deg` }] }}>{art.emojis[0]}</Text>
      <Text style={{ position: 'absolute', top: w * 0.55, right: w * 0.06, fontSize: w * 0.5, transform: [{ rotate: `${art.rotation[1]}deg` }] }}>{art.emojis[1]}</Text>
      <Text style={{ position: 'absolute', bottom: w * 0.08, left: w * 0.1, fontSize: w * 0.32, transform: [{ rotate: `${art.rotation[2]}deg` }] }}>{art.emojis[2]}</Text>
      {badge && <Text style={{ position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: 10, paddingHorizontal: 5, borderRadius: 6, overflow: 'hidden' }}>{badge}</Text>}
    </View>
  );
}

/** Стол «Диксита» и «Имаджинариума»: рука, ассоциация рассказчика, выбор карты и голосование. */
export function AssociationTable({ deck }: { deck: string }) {
  return function Table({ view, seat, legal, myTurn, onAction, disabled }: GameUIProps<V, A>) {
    const { colors } = useTheme();
    const [picked, setPicked] = useState<number | null>(null);
    const [text, setText] = useState('');
    const can = myTurn && !disabled;
    const story = view.storyteller === seat;

    useEffect(() => {
      setPicked(null);
      setText('');
    }, [view.phase, view.round]);

    const confirm = (a: A) => {
      feedback.move();
      onAction(a);
      setPicked(null);
    };

    return (
      <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 20 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {view.scores.map((sc, i) => (
            <View key={i} style={{ padding: 8, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 2, borderColor: i === view.storyteller ? colors.primary : colors.border, minWidth: 80 }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>{i === seat ? 'Вы' : `Игрок ${i + 1}`}{i === view.storyteller ? ' 📖' : ''}</Text>
              <Text style={{ color: colors.text, fontSize: 20, fontWeight: '900' }}>{sc}<Text style={{ color: colors.textMuted, fontSize: 11 }}> / {view.target}</Text></Text>
              <Text style={{ color: colors.textMuted, fontSize: 11 }}>{view.phase === 'submit' ? (view.submitted[i] ? '✓ карта' : '…') : view.phase === 'vote' ? (view.voted[i] ? '✓ голос' : '…') : ''}</Text>
            </View>
          ))}
        </ScrollView>

        {view.finished ? (
          <Text style={{ color: colors.text, textAlign: 'center', fontSize: 18, fontWeight: '800' }}>Игра окончена!</Text>
        ) : view.phase === 'clue' ? (
          story ? <Text style={{ color: colors.text, fontWeight: '700' }}>Вы рассказчик: выберите карту и придумайте ассоциацию (слово, фраза, звук…)</Text>
            : <Text style={{ color: colors.textMuted, textAlign: 'center' }}>Игрок {view.storyteller + 1} придумывает ассоциацию…</Text>
        ) : (
          <View style={{ padding: 10, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>Ассоциация рассказчика</Text>
            <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800' }}>«{view.clue}»</Text>
          </View>
        )}

        {view.phase === 'vote' && (
          <View style={{ gap: 6 }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>
              {story ? 'Игроки голосуют за вашу карту…' : can ? 'Какая из карт принадлежит рассказчику?' : 'Ваш голос принят — ждём остальных'}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {view.table.map((t, pos) => {
                const ok = can && !t.mine;
                return (
                  <Pressable key={pos} disabled={!ok} onPress={() => (picked === pos ? confirm({ t: 'vote', pos }) : (feedback.tap(), setPicked(pos)))}>
                    <ArtCard deck={deck} id={t.card} w={96} selected={picked === pos} dim={!ok && can} badge={t.mine ? 'ваша' : `№${pos + 1}`} />
                  </Pressable>
                );
              })}
            </View>
            {can && <Text style={{ color: colors.textMuted, textAlign: 'center', fontSize: 12 }}>{picked === null ? 'Коснитесь карты, затем ещё раз для подтверждения' : 'Коснитесь выбранной карты ещё раз, чтобы проголосовать'}</Text>}
          </View>
        )}

        {view.phase === 'submit' && view.table.length > 0 && (
          <Text style={{ color: colors.textMuted, textAlign: 'center' }}>Вы положили: {view.table.length} из {view.perPlayer}</Text>
        )}

        {view.last && view.phase === 'clue' && !view.finished && <LastRound view={view} deck={deck} />}
        {view.finished && view.last && <LastRound view={view} deck={deck} />}

        {view.hand.length > 0 && (
          <View style={{ gap: 6 }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>
              {can && (view.phase === 'clue' || view.phase === 'submit')
                ? view.phase === 'clue' ? 'Выберите карту:' : `Выберите карту, подходящую к ассоциации${view.perPlayer > 1 ? ` (нужно ${view.perPlayer})` : ''}:`
                : 'Ваши карты'}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
              {view.hand.map((c) => {
                const selectable = can && (view.phase === 'clue' || view.phase === 'submit');
                return (
                  <Pressable key={c} disabled={!selectable} onPress={() => { feedback.tap(); setPicked(picked === c ? null : c); }}>
                    <ArtCard deck={deck} id={c} selected={selectable && picked === c} dim={selectable && picked !== null && picked !== c} />
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

        {can && view.phase === 'clue' && picked !== null && (
          <View style={{ gap: 6 }}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Ваша ассоциация"
              placeholderTextColor={colors.textMuted}
              maxLength={80}
              style={{ height: 46, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: 12, fontSize: 16 }}
            />
            <Button title="Рассказать" disabled={!text.trim()} onPress={() => confirm({ t: 'clue', card: picked, text: text.trim() })} />
          </View>
        )}
        {can && view.phase === 'submit' && picked !== null && <Button title="Положить карту" onPress={() => confirm({ t: 'submit', card: picked })} />}
        {legal.length === 0 && !can && !view.finished && view.phase === 'submit' && <Text style={{ color: colors.textMuted, textAlign: 'center' }}>Ждём остальных игроков…</Text>}
      </ScrollView>
    );
  };
}

function LastRound({ view, deck }: { view: V; deck: string }) {
  const { colors } = useTheme();
  const last = view.last!;
  return (
    <View style={{ padding: 10, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 6 }}>
      <Text style={{ color: colors.text, fontWeight: '800' }}>Итоги прошлого раунда · «{last.clue}»</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {last.table.map((t, i) => (
          <View key={i} style={{ alignItems: 'center', gap: 2 }}>
            <ArtCard deck={deck} id={t.card} w={70} selected={t.owner === last.storyteller} />
            <Text style={{ color: colors.text, fontSize: 11 }}>{t.owner === last.storyteller ? '📖 ' : ''}Игрок {t.owner + 1}</Text>
            <Text style={{ color: colors.textMuted, fontSize: 10 }}>голоса: {t.votes.length ? t.votes.map((v) => v + 1).join(',') : '—'}</Text>
          </View>
        ))}
      </ScrollView>
      <Text style={{ color: colors.textMuted, fontSize: 12 }}>Очки за раунд: {last.delta.map((d, i) => `И${i + 1} ${d >= 0 ? '+' : ''}${d}`).join(' · ')}</Text>
    </View>
  );
}

export const DixitTable = AssociationTable({ deck: 'dixit' });
export const ImaginariumTable = AssociationTable({ deck: 'imaginarium' });
