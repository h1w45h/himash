import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export interface Me {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  bio: string | null;
  wallet: { coins: number; gems: number } | null;
  settings: {
    pushEnabled: boolean;
    pushFriendInvite: boolean;
    pushYourTurn: boolean;
    pushTournament: boolean;
    allowInvitesFrom: 'EVERYONE' | 'FRIENDS' | 'NOBODY';
    showOnlineStatus: boolean;
  } | null;
}

export const useMe = (enabled = true) =>
  useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/users/me'), enabled });

/** Сохраняет настройки на сервере и обновляет профиль в кэше без ожидания повторной загрузки. */
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<NonNullable<Me['settings']>>) => api('/users/me/settings', { method: 'PATCH', json: patch }),
    onMutate: (patch) => {
      qc.setQueryData<Me>(['me'], (old: Me | undefined) => (old ? { ...old, settings: { ...(old.settings as NonNullable<Me['settings']>), ...patch } } : old));
    },
    onError: () => void qc.invalidateQueries({ queryKey: ['me'] }),
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: { displayName?: string; bio?: string | null; username?: string }) => api('/users/me', { method: 'PATCH', json: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
}
