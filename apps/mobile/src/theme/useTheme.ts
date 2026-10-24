import { useColorScheme } from 'react-native';
import { useSettings } from '@/stores/settings';
import { darkPalette, lightPalette, type Palette } from './tokens';

export function useTheme(): { colors: Palette; isDark: boolean } {
  const system = useColorScheme();
  const mode = useSettings((s) => s.theme);
  const isDark = mode === 'system' ? system === 'dark' : mode === 'dark';
  return { colors: isDark ? darkPalette : lightPalette, isDark };
}
