import { io, type Socket } from 'socket.io-client';
import { create } from 'zustand';
import type { Ack } from '@nastolki/shared';
import { API_BASE_URL } from '@/api/client';

interface SocketStore {
  socket: Socket | null;
  connected: boolean;
}

/** Состояние соединения доступно в любом компоненте реактивно. */
export const useSocketStore = create<SocketStore>(() => ({ socket: null, connected: false }));

export class SocketError extends Error {
  constructor(
    public code: Extract<Ack, { ok: false }>['code'] | 'OFFLINE' | 'TIMEOUT',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Подключает сокет. Токен запрашивается заново при каждом (ре)коннекте, поэтому
 * истёкший JWT Clerk не ломает автоматическое переподключение.
 */
export function connectSocket(getToken: () => Promise<string | null>): Socket {
  const existing = useSocketStore.getState().socket;
  if (existing) return existing;

  const socket = io(`${API_BASE_URL}/game`, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    auth: (cb) => {
      void getToken().then((token) => cb({ token }));
    },
  });
  socket.on('connect', () => useSocketStore.setState({ connected: true }));
  socket.on('disconnect', () => useSocketStore.setState({ connected: false }));
  socket.on('connect_error', () => useSocketStore.setState({ connected: false }));
  useSocketStore.setState({ socket });
  return socket;
}

export function disconnectSocket() {
  useSocketStore.getState().socket?.close();
  useSocketStore.setState({ socket: null, connected: false });
}

/** Отправка события с подтверждением и таймаутом; ошибки сервера превращаются в SocketError. */
export async function emitAck<T = undefined>(event: string, body: unknown): Promise<T> {
  const { socket, connected } = useSocketStore.getState();
  if (!socket || !connected) throw new SocketError('OFFLINE', 'Нет соединения с сервером');
  let res: Ack<T>;
  try {
    res = (await socket.timeout(8000).emitWithAck(event, body)) as Ack<T>;
  } catch {
    throw new SocketError('TIMEOUT', 'Сервер не отвечает. Проверьте соединение.');
  }
  if (!res.ok) throw new SocketError(res.code, res.message);
  return res.data;
}
