/** Оформление, соответствующее `assetKey` предметов магазина. Бесплатные значения по умолчанию — `classic`. */
export interface BoardTheme { light: string; dark: string }

export const BOARD_THEMES: Record<string, BoardTheme> = {
  'board:classic': { light: '#EBD7B0', dark: '#B58863' },
  'board:green': { light: '#EEEED2', dark: '#769656' },
  'board:blue': { light: '#DEE3E6', dark: '#8CA2AD' },
  'board:night': { light: '#9CA3AF', dark: '#374151' },
  'board:coral': { light: '#FDE2E4', dark: '#E5989B' },
};

export const CARD_BACKS: Record<string, string> = {
  'back:classic': '#2B4C7E',
  'back:red': '#B3261E',
  'back:forest': '#2F6B3A',
  'back:space': '#1B1B3A',
  'back:gold': '#B8860B',
};

export const AVATAR_EMOJI: Record<string, string> = {
  'avatar:fox': '🦊', 'avatar:cat': '🐱', 'avatar:robot': '🤖', 'avatar:owl': '🦉',
  'avatar:wizard': '🧙', 'avatar:dragon': '🐉', 'avatar:crown': '👑',
};

export const APP_THEMES: Record<string, { primary: string; darkPrimary: string }> = {
  'theme:forest': { primary: '#2E7D32', darkPrimary: '#66BB6A' },
  'theme:ocean': { primary: '#1565C0', darkPrimary: '#64B5F6' },
  'theme:violet': { primary: '#7E57C2', darkPrimary: '#B39DDB' },
};

export const boardTheme = (key?: string | null): BoardTheme => BOARD_THEMES[key ?? ''] ?? BOARD_THEMES['board:classic']!;
export const cardBackColor = (key?: string | null): string => CARD_BACKS[key ?? ''] ?? CARD_BACKS['back:classic']!;
