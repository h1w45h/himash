import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export interface ShopItem {
  id: string;
  sku: string;
  type: 'AVATAR' | 'BOARD_THEME' | 'CARD_BACK' | 'APP_THEME';
  title: string;
  description: string | null;
  assetKey: string;
  price: number;
  rarity: 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';
  owned: boolean;
  equipped: boolean;
}

export const useShop = () => useQuery({ queryKey: ['shop'], queryFn: () => api<ShopItem[]>('/shop/items') });

export interface WalletData {
  coins: number;
  gems: number;
  daily: { available: boolean; streak: number; nextBonus: number; schedule: number[] };
}
export const useWallet = () => useQuery({ queryKey: ['wallet'], queryFn: () => api<WalletData>('/wallet') });

export function useShopActions() {
  const qc = useQueryClient();
  const refresh = () => Promise.all(['shop', 'me', 'wallet'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  return {
    buy: useMutation({ mutationFn: (id: string) => api(`/shop/items/${id}/buy`, { method: 'POST' }), onSuccess: refresh }),
    equip: useMutation({ mutationFn: (id: string) => api(`/shop/items/${id}/equip`, { method: 'POST' }), onSuccess: refresh }),
    unequip: useMutation({ mutationFn: (type: ShopItem['type']) => api('/shop/unequip', { method: 'POST', json: { type } }), onSuccess: refresh }),
    daily: useMutation({ mutationFn: () => api<{ amount: number; streak: number }>('/wallet/daily', { method: 'POST' }), onSuccess: refresh }),
  };
}

export interface AchievementItem {
  key: string;
  title: string;
  description: string;
  rarity: ShopItem['rarity'];
  target: number;
  reward: number;
  progress: number;
  unlockedAt: string | null;
}
export const useAchievements = () => useQuery({ queryKey: ['achievements'], queryFn: () => api<AchievementItem[]>('/achievements') });
