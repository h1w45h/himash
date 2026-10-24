import { getGameOrNull, registerGame } from '../core/registry';
import { aliasGame } from './alias';
import { backgammonGame } from './backgammon';
import { checkersGame } from './checkers';
import { chessGame } from './chess';
import { durakGame } from './durak';
import { codenamesGame } from './codenames';
import { goGame } from './go';
import { mafiaGame } from './mafia';
import { monopolyGame } from './monopoly';
import { pokerGame } from './poker';
import { svintusGame } from './svintus';
import { unoGame } from './uno';

/** Все реализованные игры. Добавляя игру, регистрируйте её здесь. */
const BUILTIN = [chessGame, checkersGame, durakGame, monopolyGame, unoGame, pokerGame, backgammonGame, goGame, svintusGame, mafiaGame, codenamesGame, aliasGame];

/** Идемпотентная регистрация — безопасно вызывать и на сервере, и в приложении. */
export function registerBuiltinGames(): void {
  for (const g of BUILTIN) if (!getGameOrNull(g.slug)) registerGame(g);
}

export { chessGame, checkersGame, durakGame, monopolyGame, unoGame, pokerGame, backgammonGame, goGame, svintusGame, mafiaGame, codenamesGame, aliasGame };
export * as chess from './chess';
export * as durak from './durak';
export * as monopoly from './monopoly';
export * as checkers from './checkers';
export * as uno from './uno';
export * as poker from './poker';
export * as backgammon from './backgammon';
export * as go from './go';
export * as svintus from './svintus';
export * as mafia from './mafia';
export * as codenames from './codenames';
export * as alias from './alias';
