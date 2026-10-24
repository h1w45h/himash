import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { UserBrief } from './rooms';

export interface TournamentRow {
  id: string;
  title: string;
  game: { slug: string; title: string };
  status: 'REGISTRATION' | 'IN_PROGRESS' | 'FINISHED' | 'CANCELLED';
  maxPlayers: number;
  entryFee: number;
  isPrivate: boolean;
  startsAt: string;
  participants: number;
  creator: UserBrief;
}

export const useTournaments = (scope: 'open' | 'mine' | 'finished') =>
  useQuery({ queryKey: ['tournaments', scope], queryFn: () => api<TournamentRow[]>(`/tournaments?scope=${scope}`), refetchInterval: 20_000 });

export interface TournamentDetail {
  id: string;
  title: string;
  description: string | null;
  status: TournamentRow['status'];
  creatorId: string;
  creator: UserBrief;
  game: { slug: string; title: string };
  maxPlayers: number;
  entryFee: number;
  isPrivate: boolean;
  joinCode: string | null;
  startsAt: string;
  size: number;
  myMatch: string | null;
  participants: { userId: string; seed: number | null; placement: number | null; eliminated: boolean; user: UserBrief }[];
  matches: { id: string; round: number; position: number; winnerId: string | null; matchId: string | null; playerIds: string[]; players: (UserBrief | null)[] }[];
}

export const useTournament = (id: string) =>
  useQuery({ queryKey: ['tournament', id], queryFn: () => api<TournamentDetail>(`/tournaments/${id}`), refetchInterval: 8000 });

export function useTournamentActions(id?: string) {
  const qc = useQueryClient();
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['tournament'] }), qc.invalidateQueries({ queryKey: ['tournaments'] }), qc.invalidateQueries({ queryKey: ['wallet'] })]);
  const post = (path: string, json?: unknown) => api(`/tournaments/${id}/${path}`, { method: 'POST', json });
  return {
    join: useMutation({ mutationFn: (code?: string) => post('join', { code }), onSuccess: refresh }),
    leave: useMutation({ mutationFn: () => post('leave'), onSuccess: refresh }),
    start: useMutation({ mutationFn: () => post('start'), onSuccess: refresh }),
    cancel: useMutation({ mutationFn: () => post('cancel'), onSuccess: refresh }),
    create: useMutation({
      mutationFn: (dto: { gameSlug: string; title: string; maxPlayers: number; entryFee: number; isPrivate: boolean; startsAt: string }) =>
        api<{ id: string }>('/tournaments', { method: 'POST', json: dto }),
      onSuccess: refresh,
    }),
  };
}
