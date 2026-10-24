import { getGameOrNull, registerGame } from '../core/registry';
import { checkersGame } from './checkers';
import { chessGame } from './chess';
import { durakGame } from './durak';
import { monopolyGame } from './monopoly';

/** Все реализованные игры. Добавляя игру, регистрируйте её здесь. */
const BUILTIN = [chessGame, checkersGame, durakGame, monopolyGame];

/** Идемпотентная регистрация — безопасно вызывать и на сервере, и в приложении. */
export function registerBuiltinGames(): void {
  for (const g of BUILTIN) if (!getGameOrNull(g.slug)) registerGame(g);
}

export { chessGame, checkersGame, durakGame, monopolyGame };
export * as chess from './chess';
export * as durak from './durak';
export * as monopoly from './monopoly';
export * as checkers from './checkers';
