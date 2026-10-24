import { getGame } from './registry';
import { fail, type Outcome, type Seat, type SetupCtx } from './types';

/** Состояние партии вместе с журналом — то, что сервер хранит в Match.state / MatchMove. */
export interface Session<S = unknown, A = unknown> {
  slug: string;
  state: S;
  version: number;
  log: { seat: Seat; action: A }[];
}

export function startSession(slug: string, ctx: SetupCtx): Session {
  return { slug, state: getGame(slug).setup(ctx), version: 0, log: [] };
}

/**
 * Применяет действие: валидация → apply → версия+1.
 * Единая точка входа и для сервера, и для оффлайн-партий на клиенте.
 */
export function dispatch(
  session: Session,
  seat: Seat,
  action: unknown,
): { ok: true; session: Session; outcome: Outcome | null } | { ok: false; error: string } {
  const game = getGame(session.slug);
  if (game.outcome(session.state)) return fail('Партия уже завершена');
  if (!game.currentSeats(session.state).includes(seat)) return fail('Сейчас не ваш ход');
  const v = game.validate(session.state, seat, action);
  if (!v.ok) return fail(v.error);
  const state = game.apply(session.state, seat, action);
  return {
    ok: true,
    session: {
      ...session,
      state,
      version: session.version + 1,
      log: [...session.log, { seat, action }],
    },
    outcome: game.outcome(state),
  };
}

/** Восстановление партии по журналу (реплей, проверка оффлайн-партий при синхронизации). */
export function replay(slug: string, ctx: SetupCtx, log: Session['log']): Session {
  let s = startSession(slug, ctx);
  for (const [i, e] of log.entries()) {
    const r = dispatch(s, e.seat, e.action);
    if (!r.ok) throw new Error(`Ход №${i + 1} недопустим: ${r.error}`);
    s = r.session;
  }
  return s;
}
