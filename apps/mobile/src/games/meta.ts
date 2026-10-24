/** Подписи мест и причин окончания партии — общие для онлайн и оффлайн экранов. */
export function seatLabel(slug: string, seat: number): string {
  if (slug === 'alias') return seat % 2 === 0 ? 'Красные' : 'Синие';
  if (slug === 'codenames') return seat % 2 === 0 ? (seat === 0 ? 'Красные · капитан' : 'Красные') : (seat === 1 ? 'Синие · капитан' : 'Синие');
  if (slug === 'go') return seat === 0 ? 'Чёрные' : 'Белые';
  if (slug === 'chess' || slug === 'checkers' || slug === 'backgammon') return seat === 0 ? 'Белые' : 'Чёрные';
  return `Игрок ${seat + 1}`;
}

export const BOT_LEVELS = [
  { level: 'EASY', title: 'Новичок' },
  { level: 'MEDIUM', title: 'Любитель' },
  { level: 'HARD', title: 'Опытный' },
  { level: 'EXPERT', title: 'Эксперт' },
] as const;
export type BotLevelKey = (typeof BOT_LEVELS)[number]['level'];

export const botTitle = (level: string) => BOT_LEVELS.find((l) => l.level === level)?.title ?? level;

const REASONS: Record<string, string> = {
  checkmate: 'мат',
  nomoves: 'у соперника нет ходов',
  quiet: '30 ходов без взятий — ничья',
  durak: 'остался «дураком»',
  draw: 'ничья',
  netWorth: 'лимит раундов — по состоянию',
  monopoly: 'соперники обанкротились',
  uno: 'все карты сыграны',
  points: 'набрана целевая сумма очков',
  agents: 'найдены все агенты команды',
  assassin: 'открыт убийца',
  town: 'мирные жители разоблачили мафию',
  mafia: 'мафия захватила город',
  svintus: 'остался последний игрок',
  score: 'по очкам (площадь + коми)',
  limit: 'лимит ходов — по очкам',
  mars: 'марс — двойная победа',
  oin: 'все шашки выведены',
  allchips: 'все фишки собраны',
  stalemate: 'пат — ничья',
  insufficient: 'недостаточно материала — ничья',
  repetition: 'троекратное повторение — ничья',
  fifty: 'правило 50 ходов — ничья',
  resign: 'сдача',
  timeout: 'время на ход вышло',
  abandoned: 'партия прервана',
};
export const reasonText = (reason: string) => REASONS[reason] ?? reason;
