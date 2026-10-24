import { useCallback, useEffect, useRef, useState } from 'react';
import type { MatchSnapshot, MatchUpdate } from '@nastolki/shared';
import { SocketError, emitAck, useSocketStore } from './socket';

/** Локальное применение хода для мгновенной реакции интерфейса (только игры без скрытой информации). */
export type ApplyLocal = (view: unknown, seat: number, action: unknown) => unknown;

/**
 * Состояние онлайн-партии.
 *  - при подключении и КАЖДОМ реконнекте запрашивает снимок (resync);
 *  - инкременты `match:update` несут полный `view`, поэтому пропущенные события не страшны;
 *  - ход отправляется с `expectedVersion`; при STALE состояние пересинхронизируется.
 */
export function useMatch(matchId: string, applyLocal?: ApplyLocal) {
  const socket = useSocketStore((s) => s.socket);
  const connected = useSocketStore((s) => s.connected);
  const [snap, setSnap] = useState<MatchSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const ref = useRef<MatchSnapshot | null>(null);
  ref.current = snap;

  const resync = useCallback(async () => {
    try {
      setSnap(await emitAck<MatchSnapshot>('match:resync', { matchId, sinceVersion: ref.current?.version }));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [matchId]);

  useEffect(() => {
    if (connected) void resync();
  }, [connected, resync]);

  useEffect(() => {
    if (!socket) return;
    const onUpdate = (u: MatchUpdate) => {
      if (u.matchId !== matchId) return;
      setSnap((prev) => (prev && u.version < prev.version ? prev : prev ? { ...prev, ...u } : prev));
    };
    socket.on('match:update', onUpdate);
    return () => {
      socket.off('match:update', onUpdate);
    };
  }, [socket, matchId]);

  const sendAction = useCallback(
    async (action: unknown) => {
      const cur = ref.current;
      if (!cur || pending || cur.status !== 'IN_PROGRESS' || cur.seat === null) return;
      setPending(true);
      setError(null);
      if (applyLocal) {
        setSnap({ ...cur, view: applyLocal(cur.view, cur.seat, action), legal: [], currentSeats: [] });
      }
      try {
        await emitAck('match:action', { matchId, expectedVersion: cur.version, action });
      } catch (e) {
        setSnap(cur); // откат оптимистичного хода
        if (e instanceof SocketError && e.code === 'STALE') await resync();
        else setError((e as Error).message);
      } finally {
        setPending(false);
      }
    },
    [matchId, pending, applyLocal, resync],
  );

  const resign = useCallback(async () => {
    try {
      await emitAck('match:resign', { matchId });
    } catch (e) {
      setError((e as Error).message);
    }
  }, [matchId]);

  const myTurn = !!snap && snap.seat !== null && snap.status === 'IN_PROGRESS' && snap.currentSeats.includes(snap.seat);
  return { snap, error, pending, connected, myTurn, sendAction, resign, resync };
}

/** Секунды до дедлайна хода (null, если таймера нет). */
export function useCountdown(deadlineIso: string | null): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!deadlineIso) return setLeft(null);
    const tick = () => setLeft(Math.max(0, Math.ceil((new Date(deadlineIso).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [deadlineIso]);
  return left;
}
