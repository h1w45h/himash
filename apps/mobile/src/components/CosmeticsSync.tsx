import { useAuth } from '@/auth/session';
import { useEffect } from 'react';
import { useMe } from '@/api/users';
import { useSettings } from '@/stores/settings';

/** Переносит экипированное оформление из профиля в локальное хранилище (используется без сети). */
export function CosmeticsSync() {
  const { isSignedIn } = useAuth();
  const me = useMe(!!isSignedIn);
  const s = me.data?.settings;
  useEffect(() => {
    if (!s) return;
    useSettings.getState().set({ boardTheme: s.activeBoardTheme, cardBack: s.activeCardBack, appTheme: s.activeAppTheme });
  }, [s?.activeBoardTheme, s?.activeCardBack, s?.activeAppTheme]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
