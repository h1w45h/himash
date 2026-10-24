export type AchievementRarity = 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';

/** Правило, по которому считается прогресс. Все счётчики — по завершённым партиям игрока. */
export type AchievementRule =
  | { type: 'wins'; game?: string }
  | { type: 'games'; game?: string }
  | { type: 'rating'; game?: string }
  | { type: 'distinctGames' }
  | { type: 'friends' };

export interface AchievementDef {
  key: string;
  title: string;
  description: string;
  rarity: AchievementRarity;
  target: number;
  reward: number;
  rule: AchievementRule;
  /** Достижение конкретной игры (для иконки и группировки). */
  gameSlug?: string;
  hidden?: boolean;
}

const firstWin = (slug: string, title: string): AchievementDef => ({
  key: `${slug}_first_win`, title: `Первая победа: ${title}`, description: `Выиграйте партию в «${title}»`,
  rarity: 'COMMON', target: 1, reward: 50, rule: { type: 'wins', game: slug }, gameSlug: slug,
});

export const ACHIEVEMENTS: AchievementDef[] = [
  { key: 'first_win', title: 'Первая кровь', description: 'Выиграйте свою первую партию', rarity: 'COMMON', target: 1, reward: 50, rule: { type: 'wins' } },
  { key: 'wins_10', title: 'Игрок', description: 'Выиграйте 10 партий', rarity: 'COMMON', target: 10, reward: 100, rule: { type: 'wins' } },
  { key: 'wins_50', title: 'Ветеран', description: 'Выиграйте 50 партий', rarity: 'RARE', target: 50, reward: 300, rule: { type: 'wins' } },
  { key: 'wins_200', title: 'Легенда стола', description: 'Выиграйте 200 партий', rarity: 'LEGENDARY', target: 200, reward: 1500, rule: { type: 'wins' } },
  { key: 'games_25', title: 'Завсегдатай', description: 'Сыграйте 25 партий', rarity: 'COMMON', target: 25, reward: 100, rule: { type: 'games' } },
  { key: 'games_100', title: 'Настольный фанат', description: 'Сыграйте 100 партий', rarity: 'RARE', target: 100, reward: 400, rule: { type: 'games' } },
  { key: 'explorer', title: 'Исследователь', description: 'Сыграйте в 5 разных игр', rarity: 'RARE', target: 5, reward: 200, rule: { type: 'distinctGames' } },
  { key: 'friend_1', title: 'Не один', description: 'Добавьте первого друга', rarity: 'COMMON', target: 1, reward: 30, rule: { type: 'friends' } },
  { key: 'friends_5', title: 'Душа компании', description: 'Добавьте 5 друзей', rarity: 'RARE', target: 5, reward: 150, rule: { type: 'friends' } },
  { key: 'rating_1400', title: 'Растущая звезда', description: 'Достигните рейтинга 1400 в любой игре', rarity: 'RARE', target: 1400, reward: 300, rule: { type: 'rating' } },
  { key: 'rating_1700', title: 'Гроссмейстер', description: 'Достигните рейтинга 1700 в любой игре', rarity: 'EPIC', target: 1700, reward: 1000, rule: { type: 'rating' } },
  firstWin('chess', 'Шахматы'),
  firstWin('checkers', 'Шашки'),
  firstWin('durak', 'Дурак'),
  firstWin('uno', 'Uno'),
  firstWin('monopoly', 'Монополия'),
  { key: 'chess_wins_25', title: 'Шахматный практик', description: 'Выиграйте 25 партий в шахматы', rarity: 'EPIC', target: 25, reward: 600, rule: { type: 'wins', game: 'chess' }, gameSlug: 'chess' },
];
