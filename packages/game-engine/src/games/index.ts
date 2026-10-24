import { getGameOrNull, registerGame } from '../core/registry';
import { chessGame } from './chess';
import { durakGame } from './durak';

/** Все реализованные игры. Добавляя игру, регистрируйте её здесь. */
const BUILTIN = [chessGame, durakGame];

/** Идемпотентная регистрация — безопасно вызывать и на сервере, и в приложении. */
export function registerBuiltinGames(): void {
  for (const g of BUILTIN) if (!getGameOrNull(g.slug)) registerGame(g);
}

export { chessGame, durakGame };
export * as chess from './chess';
export * as durak from './durak';
