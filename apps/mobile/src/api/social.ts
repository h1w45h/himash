import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PresenceStatusDto } from '@nastolki/shared';
import { api } from './client';
import type { UserBrief } from './rooms';

export interface FriendEntry {
  friendshipId: string;
  user: UserBrief & { lastSeenAt: string };
  status: PresenceStatusDto;
  unread: number;
}
export interface FriendsData {
  friends: FriendEntry[];
  incoming: { friendshipId: string; user: UserBrief }[];
  outgoing: { friendshipId: string; user: UserBrief }[];
}

export const useFriends = () =>
  useQuery({ queryKey: ['friends'], queryFn: () => api<FriendsData>('/friends'), refetchInterval: 30_000 });

export function useFriendActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['friends'] });
  return {
    request: useMutation({ mutationFn: (v: { userId?: string; username?: string }) => api('/friends/requests', { method: 'POST', json: v }), onSuccess: refresh }),
    accept: useMutation({ mutationFn: (id: string) => api(`/friends/requests/${id}/accept`, { method: 'POST' }), onSuccess: refresh }),
    decline: useMutation({ mutationFn: (id: string) => api(`/friends/requests/${id}/decline`, { method: 'POST' }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (userId: string) => api(`/friends/${userId}`, { method: 'DELETE' }), onSuccess: refresh }),
    block: useMutation({ mutationFn: (userId: string) => api(`/friends/blocks/${userId}`, { method: 'POST' }), onSuccess: refresh }),
  };
}

export const useUserSearch = (q: string) =>
  useQuery({
    queryKey: ['users', 'search', q],
    queryFn: () => api<UserBrief[]>(`/users/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
  });

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, string> | null;
  readAt: string | null;
  createdAt: string;
}
export const useNotifications = () =>
  useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ items: NotificationItem[]; unread: number }>('/notifications'),
    refetchInterval: 60_000,
  });

export interface Stats {
  ratings: { rating: number; wins: number; losses: number; draws: number; peak: number; game: { slug: string; title: string } }[];
  totals: { wins: number; losses: number; draws: number; left: number };
}
export const useStats = () => useQuery({ queryKey: ['stats'], queryFn: () => api<Stats>('/users/me/stats') });

export interface HistoryItem {
  matchPlayerId: string;
  seat: number;
  result: 'WIN' | 'LOSS' | 'DRAW' | 'LEFT' | null;
  ratingDelta: number | null;
  id: string;
  finishedAt: string | null;
  isRated: boolean;
  game: { slug: string; title: string };
  players: { seat: number; result: string | null; isBot: boolean; user: UserBrief | null }[];
}
export const useHistory = () =>
  useInfiniteQuery({
    queryKey: ['history'],
    queryFn: ({ pageParam }) => api<{ items: HistoryItem[]; nextCursor: string | null }>(`/matches/mine${pageParam ? `?cursor=${pageParam}` : ''}`),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const useActiveMatch = () =>
  useQuery({ queryKey: ['active-match'], queryFn: () => api<{ id: string; game: { slug: string; title: string } } | null>('/matches/active'), refetchInterval: 15_000 });

export interface Invitation {
  id: string;
  sender: UserBrief;
  room: { code: string; game: { slug: string; title: string } };
}
export const useInvitations = () =>
  useQuery({ queryKey: ['invitations'], queryFn: () => api<Invitation[]>('/invitations'), refetchInterval: 15_000 });

export interface PublicProfile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  ratings: { rating: number; wins: number; losses: number; draws: number; game: { slug: string; title: string } }[];
}
export const usePublicProfile = (id: string) => useQuery({ queryKey: ['profile', id], queryFn: () => api<PublicProfile>(`/users/${id}`) });

export interface LeaderRow {
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  user: UserBrief;
}
export const useLeaderboard = (slug: string) => useQuery({ queryKey: ['leaderboard', slug], queryFn: () => api<LeaderRow[]>(`/games/${slug}/leaderboard`) });
