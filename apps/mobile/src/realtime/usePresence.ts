import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { PresenceUpdate } from '@nastolki/shared';
import type { FriendsData } from '@/api/social';
import { emitAck, useSocketStore } from './socket';

/** Heartbeat присутствия и живое обновление статусов друзей в кэше. */
export function usePresence() {
  const qc = useQueryClient();
  const socket = useSocketStore((s) => s.socket);
  const connected = useSocketStore((s) => s.connected);

  useEffect(() => {
    if (!socket || !connected) return;
    const onUpdate = (u: PresenceUpdate) =>
      qc.setQueryData<FriendsData>(['friends'], (old: FriendsData | undefined) =>
        old ? { ...old, friends: old.friends.map((f: FriendsData['friends'][number]) => (f.user.id === u.userId ? { ...f, status: u.status } : f)) } : old,
      );
    // Личные сообщения и приглашения сразу обновляют бейджи.
    const onDm = () => void qc.invalidateQueries({ queryKey: ['friends'] });
    const onInvite = () => void qc.invalidateQueries({ queryKey: ['invitations'] });
    socket.on('presence:update', onUpdate);
    socket.on('chat:message', onDm);
    socket.on('invite:received', onInvite);
    const timer = setInterval(() => void emitAck('presence:ping', {}).catch(() => undefined), 30_000);
    return () => {
      clearInterval(timer);
      socket.off('presence:update', onUpdate);
      socket.off('chat:message', onDm);
      socket.off('invite:received', onInvite);
    };
  }, [socket, connected, qc]);
}
