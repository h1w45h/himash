import { fail, ok, type GameDefinition } from '@nastolki/game-engine';

interface State {
  total: number;
  turn: number;
  winner: number | null;
}
type Action = { add: 1 | 2 | 3 };

/**
 * Тестовая игра «Счёт до 10»: игроки по очереди прибавляют 1–3,
 * кто довёл сумму до 10 и больше — победил. Нужна только для интеграционных тестов сервера.
 */
/** Запись каталога для тестовой игры (в seed её нет). */
export const countingGameRow = {
  slug: 'test-counting', title: 'Счёт до 10', tagline: 'тест', description: 'тест', rulesMarkdown: 'тест',
  category: 'CLASSIC' as const, minPlayers: 2, maxPlayers: 2, avgMinutes: 1, hasBots: true, isRated: true,
  status: 'BETA' as const, sortOrder: 9999,
};

export const countingGame: GameDefinition<State, Action> = {
  slug: 'test-counting',
  minPlayers: 2,
  maxPlayers: 2,
  setup: () => ({ total: 0, turn: 0, winner: null }),
  legalActions: () => [{ add: 1 }, { add: 2 }, { add: 3 }],
  validate: (_s, _seat, a) => ([1, 2, 3].includes(a?.add) ? ok(undefined) : fail('Можно прибавить 1, 2 или 3')),
  apply: (s, seat, a) => {
    const total = s.total + a.add;
    return { total, turn: 1 - s.turn, winner: total >= 10 ? seat : null };
  },
  currentSeats: (s) => [s.turn],
  outcome: (s) => (s.winner === null ? null : { winners: [s.winner], ranking: [s.winner, 1 - s.winner], reason: 'target' }),
  view: (s) => s,
};
