import { useQuery } from '@tanstack/react-query';
import { api } from './client';

export interface Me {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  bio: string | null;
  wallet: { coins: number; gems: number } | null;
}

export const useMe = (enabled = true) =>
  useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/users/me'), enabled });
