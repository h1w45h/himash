import { Stack, useRouter } from 'expo-router';
import { Alert, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, ErrorText } from '@/components/ui';
import { GAME_UIS } from '@/games/registry';
import { GenericBoard } from '@/games/GenericBoard';
import { botTitle, reasonText, seatLabel } from '@/games/meta';
import { useLocalMatch, type LocalConfig } from '@/games/useLocalMatch';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

/** Экран локальной партии: и «на одном устройстве», и против бота. Работает без сети. */
export function LocalMatchScreen({ cfg, title }: { cfg: LocalConfig; title: string }) {
  const { colors } = useTheme();
  const router = useRouter();
  const m = useLocalMatch(cfg);
  const Board = GAME_UIS[cfg.slug] ?? GenericBoard;
  const vsBot = !!cfg.bots && Object.keys(cfg.bots).length > 0;

  const confirmRestart = () =>
    Alert.alert('Начать заново?', 'Текущая партия будет потеряна.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Заново', style: 'destructive', onPress: m.restart },
    ]);

  const winnerText = !m.outcome ? '' : m.outcome.winners.length === 0 ? 'Ничья'
    : vsBot ? (m.outcome.winners.includes(m.viewSeat) ? 'Вы победили! 🎉' : 'Вы проиграли')
    : `Победа: ${seatLabel(cfg.slug, m.outcome.winners[0] ?? 0)}`;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title, headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text }} />

      <View style={{ flexDirection: 'row', gap: 8, padding: 12 }}>
        {Array.from({ length: cfg.players }, (_, seat) => {
          const level = cfg.bots?.[seat];
          const active = m.currentSeats.includes(seat);
          return (
            <View key={seat} style={{ flex: 1, padding: 10, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 2, borderColor: active ? colors.primary : colors.border }}>
              <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '700' }}>
                {level ? `🤖 ${botTitle(level)}` : vsBot ? 'Вы' : seatLabel(cfg.slug, seat)}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                {level ? seatLabel(cfg.slug, seat) : ' '}{active ? (level && m.thinking ? ' · думает…' : ' · ход') : ''}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={{ flex: 1, paddingHorizontal: 12 }}>
        <Board
          view={m.view}
          seat={m.viewSeat}
          orientation={vsBot ? m.viewSeat : 0}
          legal={m.legal}
          myTurn={m.myTurn}
          onAction={m.act}
          disabled={!!m.outcome}
        />
      </View>

      <ErrorText>{m.error}</ErrorText>

      <View style={{ padding: 16, gap: 8 }}>
        {m.outcome && (
          <>
            <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800', textAlign: 'center' }}>{winnerText}</Text>
            <Text style={{ color: colors.textMuted, textAlign: 'center' }}>{reasonText(m.outcome.reason)}</Text>
          </>
        )}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}><Button title={m.outcome ? 'Реванш' : 'Заново'} variant="secondary" onPress={m.outcome ? m.restart : confirmRestart} /></View>
          <View style={{ flex: 1 }}><Button title="Выйти" variant={m.outcome ? 'primary' : 'secondary'} onPress={() => router.back()} /></View>
        </View>
      </View>

      {m.handover !== null && (
        <View style={{ position: 'absolute', inset: 0, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }}>
          <Text style={{ color: colors.text, fontSize: 24, fontWeight: '800', textAlign: 'center' }}>Передайте устройство</Text>
          <Text style={{ color: colors.textMuted, fontSize: 18 }}>{seatLabel(cfg.slug, m.handover)}</Text>
          <Button title="Я готов" onPress={m.ackHandover} />
        </View>
      )}
    </SafeAreaView>
  );
}
