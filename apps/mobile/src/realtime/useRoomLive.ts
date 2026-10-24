import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { Room } from '@/api/rooms';
import { emitAck, useSocketStore } from './socket';

/**
 * Подписка на события комнаты: `room:updated` кладётся прямо в кэш React Query.
 * Подписываемся заново после каждого реконнекта — серверные socket-комнаты не переживают разрыв.
 */
export function useRoomLive(code: string) {
  const qc = useQueryClient();
  const socket = useSocketStore((s) => s.socket);
  const connected = useSocketStore((s) => s.connected);

  useEffect(() => {
    if (!socket || !connected) return;
    const onUpdate = (room: Room) => qc.setQueryData(['rooms', room.code], room);
    socket.on('room:updated', onUpdate);
    // Если ещё не вошли в комнату (REST join не завершён), ошибка допустима — сработает опрос.
    void emitAck('room:join', { code }).catch(() => undefined);
    return () => {
      socket.off('room:updated', onUpdate);
      void emitAck('room:leave', { code }).catch(() => undefined);
    };
  }, [socket, connected, code, qc]);
}
