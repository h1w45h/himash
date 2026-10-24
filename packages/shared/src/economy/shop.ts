import type { AchievementRarity } from './achievements';

export type ShopItemType = 'AVATAR' | 'BOARD_THEME' | 'CARD_BACK' | 'APP_THEME';

/** Каталог магазина. `assetKey` сопоставляется с оформлением на клиенте (apps/mobile/src/theme/cosmetics.ts). */
export interface ShopItemDef {
  sku: string;
  type: ShopItemType;
  title: string;
  description: string;
  assetKey: string;
  price: number;
  rarity: AchievementRarity;
  gameSlug?: string;
}

const avatar = (id: string, title: string, price: number, rarity: AchievementRarity = 'COMMON'): ShopItemDef => ({
  sku: `avatar_${id}`, type: 'AVATAR', title, description: 'Аватар для профиля', assetKey: `avatar:${id}`, price, rarity,
});
const board = (id: string, title: string, price: number): ShopItemDef => ({
  sku: `board_${id}`, type: 'BOARD_THEME', title, description: 'Цвета доски для шахмат и шашек', assetKey: `board:${id}`, price, rarity: 'RARE',
});
const back = (id: string, title: string, price: number, rarity: AchievementRarity = 'COMMON'): ShopItemDef => ({
  sku: `back_${id}`, type: 'CARD_BACK', title, description: 'Рубашка для карточных игр', assetKey: `back:${id}`, price, rarity,
});
const theme = (id: string, title: string): ShopItemDef => ({
  sku: `theme_${id}`, type: 'APP_THEME', title, description: 'Акцентный цвет приложения', assetKey: `theme:${id}`, price: 500, rarity: 'EPIC',
});

export const SHOP: ShopItemDef[] = [
  avatar('fox', 'Лис', 100), avatar('cat', 'Кот', 100), avatar('robot', 'Робот', 200), avatar('owl', 'Сова', 150),
  avatar('wizard', 'Маг', 250, 'RARE'), avatar('dragon', 'Дракон', 400, 'EPIC'), avatar('crown', 'Корона', 800, 'LEGENDARY'),
  board('green', 'Зелёная доска', 300), board('blue', 'Голубая доска', 300), board('night', 'Ночная доска', 500), board('coral', 'Коралловая доска', 500),
  back('red', 'Красная рубашка', 150), back('forest', 'Лесная рубашка', 200), back('space', 'Космос', 300, 'RARE'), back('gold', 'Золотая рубашка', 400, 'EPIC'),
  theme('forest', 'Тема «Лес»'), theme('ocean', 'Тема «Океан»'), theme('violet', 'Тема «Сирень»'),
];

/** Ежедневный бонус по дням серии (после 7-го дня цикл повторяется с последнего значения). */
export const DAILY_BONUS = [20, 30, 40, 60, 80, 120, 200];
