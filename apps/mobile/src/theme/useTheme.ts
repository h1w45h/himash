import { useColorScheme } from 'react-native';
import { useSettings } from '@/stores/settings';
import { APP_THEMES } from './cosmetics';
import { darkPalette, lightPalette, type Palette } from './tokens';

export function useTheme(): { colors: Palette; isDark: boolean } {
  const system = useColorScheme();
  const mode = useSettings((s) => s.theme);
  const accent = useSettings((s) => s.appTheme);
  const isDark = mode === 'system' ? system === 'dark' : mode === 'dark';
  const base = isDark ? darkPalette : lightPalette;
  const t = accent ? APP_THEMES[accent] : undefined;
  const colors = t ? { ...base, primary: isDark ? t.darkPrimary : t.primary, onPrimary: isDark ? '#10130F' : '#FFFFFF' } : base;
  return { colors, isDark };
}
