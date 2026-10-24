/** Номер места за столом, с 0. */
export type Seat = number;

export type Failure = { ok: false; error: string };
export type Result<T = void> = { ok: true; value: T } | Failure;

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = (error: string): Failure => ({ ok: false, error });

export interface Outcome {
  /** Победители; пусто при ничьей. */
  winners: Seat[];
  /** Места по порядку (1-е место первым) — для многопользовательских игр и рейтинга. */
  ranking: Seat[];
  /** Причина окончания: 'checkmate', 'stalemate', 'resign', 'timeout'... */
  reason: string;
  scores?: Record<Seat, number>;
}

export interface SetupCtx<Options = unknown> {
  players: number;
  seed: string;
  variant?: string;
  options?: Options;
}

export interface BotContext {
  level: 'EASY' | 'MEDIUM' | 'HARD' | 'EXPERT';
  /** Генератор бота независим от генератора игры, чтобы не влиять на ход партии. */
  rngSeed: string;
}

/**
 * Контракт игры. Все функции чистые: состояние иммутабельно, `apply` возвращает новое.
 * Состояние обязано сериализоваться в JSON (хранится в Match.state).
 */
export interface GameDefinition<State, Action, View = State, Options = unknown> {
  readonly slug: string;
  readonly minPlayers: number;
  readonly maxPlayers: number;

  setup(ctx: SetupCtx<Options>): State;
  /** Все допустимые действия места (для подсветки в UI и перебора ботом). */
  legalActions(state: State, seat: Seat): Action[];
  validate(state: State, seat: Seat, action: Action): Result;
  apply(state: State, seat: Seat, action: Action): State;
  /** Кто может ходить сейчас (несколько мест — одновременные ходы, напр. ночь в Мафии). */
  currentSeats(state: State): Seat[];
  outcome(state: State): Outcome | null;
  /** Проекция состояния для игрока: скрытая информация (чужие карты) вырезается. */
  view(state: State, seat: Seat | null): View;
  /**
   * Что показывать зрителям о совершённом действии. Если действие раскрывает скрытую информацию
   * (например, добор карты), игра вырезает её для всех, кроме `actor`. По умолчанию — действие как есть.
   */
  redactAction?(action: Action, actor: Seat, viewer: Seat | null): Action | null;
  /** Выбор хода ботом; отсутствует — для игры нет бота. */
  chooseBotAction?(state: State, seat: Seat, bot: BotContext): Action;
  /** Можно ли игроку писать в чат партии прямо сейчас (мафия ночью, выбывшие игроки и т.п.). По умолчанию — можно. */
  chatAllowed?(state: State, seat: Seat): boolean;
  /** Действие, выполняемое при истечении таймера хода. */
  timeoutAction?(state: State, seat: Seat): Action | null;
}

export type AnyGame = GameDefinition<any, any, any, any>;
