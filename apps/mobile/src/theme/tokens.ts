export interface Palette {
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textMuted: string;
  primary: string;
  onPrimary: string;
  border: string;
  success: string;
  danger: string;
}

export const lightPalette: Palette = {
  bg: '#F6F4EF',
  surface: '#FFFFFF',
  surfaceAlt: '#EDEAE2',
  text: '#1B1A17',
  textMuted: '#6B675E',
  primary: '#C2410C',
  onPrimary: '#FFFFFF',
  border: '#DDD8CB',
  success: '#15803D',
  danger: '#B91C1C',
};

export const darkPalette: Palette = {
  bg: '#14130F',
  surface: '#1F1D18',
  surfaceAlt: '#2A2720',
  text: '#F3F0E8',
  textMuted: '#A29D90',
  primary: '#FB923C',
  onPrimary: '#1B1A17',
  border: '#37332A',
  success: '#4ADE80',
  danger: '#F87171',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 20 } as const;
