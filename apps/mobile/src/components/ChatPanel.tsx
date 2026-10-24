import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import type { ChatMessageDto } from '@nastolki/shared';
import { api } from '@/api/client';
import { emitAck, useSocketStore } from '@/realtime/socket';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

/** Чат комнаты или партии: история по REST, новые сообщения по сокету. */
export function ChatPanel({ scope, target, myUserId }: { scope: 'ROOM' | 'MATCH'; target: string; myUserId: string }) {
  const { colors } = useTheme();
  const socket = useSocketStore((s) => s.socket);
  const history = useQuery({
    queryKey: ['chat', scope, target],
    queryFn: () => api<ChatMessageDto[]>(`/chat/${scope === 'ROOM' ? 'rooms' : 'matches'}/${target}`),
  });
  const [live, setLive] = useState<ChatMessageDto[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const list = useRef<FlatList<ChatMessageDto>>(null);

  useEffect(() => {
    if (!socket) return;
    const onMsg = (m: ChatMessageDto) => setLive((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    socket.on('chat:message', onMsg);
    return () => {
      socket.off('chat:message', onMsg);
    };
  }, [socket]);

  const all = [...(history.data ?? []), ...live].filter((m, i, a) => a.findIndex((x) => x.id === m.id) === i);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    setError(null);
    try {
      await emitAck('chat:send', { scope, target, body });
    } catch (e) {
      setText(body);
      setError((e as Error).message);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ gap: 8 }}>
      <FlatList
        ref={list}
        data={all}
        keyExtractor={(m) => m.id}
        style={{ maxHeight: 220 }}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={<Text style={{ color: colors.textMuted }}>Сообщений пока нет</Text>}
        renderItem={({ item }) => {
          const mine = item.sender?.id === myUserId;
          return (
            <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', backgroundColor: mine ? colors.primary : colors.surfaceAlt, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 6, marginVertical: 2, maxWidth: '85%' }}>
              {!mine && <Text style={{ color: colors.textMuted, fontSize: 11 }}>{item.sender?.displayName}</Text>}
              <Text style={{ color: mine ? colors.onPrimary : colors.text }}>{item.body}</Text>
            </View>
          );
        }}
      />
      {error && <Text style={{ color: colors.danger, fontSize: 12 }}>{error}</Text>}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Сообщение"
          placeholderTextColor={colors.textMuted}
          maxLength={500}
          onSubmitEditing={send}
          returnKeyType="send"
          style={{ flex: 1, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: 12 }}
        />
        <Pressable onPress={send} style={{ height: 44, paddingHorizontal: 16, borderRadius: radius.md, backgroundColor: colors.primary, justifyContent: 'center' }}>
          <Text style={{ color: colors.onPrimary, fontWeight: '700' }}>→</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
