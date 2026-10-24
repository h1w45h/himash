import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateRoomDto, MatchmakingStatus } from '@nastolki/shared';
import { useSocketStore } from '@/realtime/socket';
import { api } from './client';

export interface UserBrief {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  avatarId?: string | null;
}

export interface RoomPlayer {
  id: string;
  seat: number;
  isReady: boolean;
  isBot: boolean;
  botLevel: 'EASY' | 'MEDIUM' | 'HARD' | 'EXPERT' | null;
  user: UserBrief | null;
}

export interface Room {
  id: string;
  code: string;
  status: 'WAITING' | 'STARTING' | 'IN_PROGRESS' | 'FINISHED' | 'CLOSED';
  visibility: 'PUBLIC' | 'PRIVATE' | 'FRIENDS';
  hostId: string;
  host: UserBrief;
  game: { slug: string; title: string };
  maxPlayers: number;
  minPlayers: number;
  isRated: boolean;
  turnTimeSec: number | null;
  variantKey: string | null;
  hasPassword: boolean;
  matchId: string | null;
  players: RoomPlayer[];
}

export const usePublicRooms = (game?: string) =>
  useQuery({
    queryKey: ['rooms', 'public', game ?? 'all'],
    queryFn: () => api<Room[]>(`/rooms${game ? `?game=${encodeURIComponent(game)}` : ''}`),
    refetchInterval: 5000, // до появления сокетов (шаг 5) список обновляем опросом
  });

/** Комната-лобби: живые обновления через `useRoomLive`, REST — первичная загрузка и запасной канал. */
export function useRoom(code: string) {
  const live = useSocketStore((s) => s.connected);
  return useQuery({
    queryKey: ['rooms', code],
    queryFn: () => api<Room>(`/rooms/${code}`),
    // Есть сокет — события приходят сами, опрос лишь страховка; нет сокета — опрашиваем часто.
    refetchInterval: live ? 15_000 : 2000,
  });
}

export function useRoomActions(code?: string) {
  const qc = useQueryClient();
  const sync = (room: Room) => qc.setQueryData(['rooms', room.code], room);
  const post = <T = Room>(path: string, json?: unknown) => api<T>(path, { method: 'POST', json });

  return {
    create: useMutation({ mutationFn: (dto: Partial<CreateRoomDto> & Pick<CreateRoomDto, 'gameSlug' | 'maxPlayers'>) => post('/rooms', dto), onSuccess: sync }),
    join: useMutation({ mutationFn: (v: { code: string; password?: string }) => post(`/rooms/${v.code.trim().toUpperCase()}/join`, { password: v.password }), onSuccess: sync }),
    leave: useMutation({ mutationFn: () => post(`/rooms/${code}/leave`), onSuccess: () => qc.removeQueries({ queryKey: ['rooms', code] }) }),
    ready: useMutation({ mutationFn: (ready: boolean) => post(`/rooms/${code}/ready`, { ready }), onSuccess: sync }),
    addBot: useMutation({ mutationFn: () => post(`/rooms/${code}/bots`, { level: 'MEDIUM' }), onSuccess: sync }),
    kick: useMutation({ mutationFn: (seat: number) => api<Room>(`/rooms/${code}/players/${seat}`, { method: 'DELETE' }), onSuccess: sync }),
    start: useMutation({ mutationFn: () => post(`/rooms/${code}/start`), onSuccess: sync }),
  };
}

export const matchmaking = {
  join: (gameSlug: string, variantKey?: string) => api<MatchmakingStatus>('/matchmaking/join', { method: 'POST', json: { gameSlug, variantKey } }),
  leave: () => api<{ ok: true }>('/matchmaking', { method: 'DELETE' }),
  status: () => api<MatchmakingStatus>('/matchmaking/status'),
};

/** Комната, в которой я сейчас нахожусь (для кнопки «Пригласить» у друзей). */
export const useMyRoom = () => useQuery({ queryKey: ['rooms', 'mine'], queryFn: () => api<Room | null>('/rooms/mine'), refetchInterval: 20_000 });

export const inviteToRoom = (code: string, userId: string) => api(`/rooms/${code}/invite`, { method: 'POST', json: { userId } });
