import { dispatch, getGame, startSession, type Outcome, type Session } from '@nastolki/game-engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MMKV } from 'react-native-mmkv';
import { feedback } from '@/services/feedback';

const store = new MMKV({ id: 'local-matches' });

export interface LocalConfig {
  slug: string;
  players: number;
  /** Места, которыми играет бот, и их уровень. Остальные — люди. */
  bots?: Record<number, 'EASY' | 'MEDIUM' | 'HARD' | 'EXPERT'>;
  /** Если у игры скрытая информация — между ходами людей показывается экран передачи устройства. */
  hiddenInfo?: boolean;
  /** Ключ сохранения; одна незавершённая партия на ключ. */
  saveKey: string;
}

interface Saved {
  session: Session;
  players: number;
}

const randomSeed = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function load(cfg: LocalConfig): Session | null {
  try {
    const raw = store.getString(cfg.saveKey);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Saved;
    return saved.session.slug === cfg.slug && saved.players === cfg.players ? saved.session : null;
  } catch {
    return null; // повреждённое сохранение не должно ломать запуск
  }
}

export const hasSavedLocalMatch = (cfg: Pick<LocalConfig, 'saveKey'>) => store.contains(cfg.saveKey);
export const clearSavedLocalMatch = (saveKey: string) => store.delete(saveKey);

/**
 * Локальная партия полностью на устройстве (без сети): pass-and-play и игра с ботом.
 * Состояние автосохраняется после каждого хода и восстанавливается при следующем запуске.
 */
export function useLocalMatch(cfg: LocalConfig) {
  const game = useMemo(() => getGame(cfg.slug), [cfg.slug]);
  const [session, setSession] = useState<Session>(() => load(cfg) ?? startSession(cfg.slug, { players: cfg.players, seed: randomSeed() }));
  const [error, setError] = useState<string | null>(null);
  const [handover, setHandover] = useState<number | null>(null);
  const [thinking, setThinking] = useState(false);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  const outcome: Outcome | null = game.outcome(session.state);
  const seats: number[] = outcome ? [] : game.currentSeats(session.state);
  const current = seats[0];
  const botLevel = current !== undefined ? cfg.bots?.[current] : undefined;

  // Автосохранение. Законченную партию удаляем — продолжать нечего.
  useEffect(() => {
    if (outcome) store.delete(cfg.saveKey);
    else store.set(cfg.saveKey, JSON.stringify({ session, players: cfg.players } satisfies Saved));
  }, [session, outcome, cfg.saveKey, cfg.players]);

  useEffect(() => {
    if (outcome) (outcome.winners.length ? feedback.win : feedback.tap)();
  }, [outcome]);

  const apply = useCallback((seat: number, action: unknown) => {
    setSession((prev) => {
      const r = dispatch(prev, seat, action);
      if (!r.ok) {
        setError(r.error);
        return prev;
      }
      setError(null);
      return r.session;
    });
  }, []);

  // Ход бота: небольшая пауза, затем расчёт в отдельном «тике», чтобы интерфейс успел обновиться.
  useEffect(() => {
    if (outcome || current === undefined || !botLevel) return;
    setThinking(true);
    const t = setTimeout(() => {
      const state = session.state;
      let action = game.chooseBotAction?.(state, current, { level: botLevel, rngSeed: `${session.log.length}:${randomSeed()}` });
      if (action === undefined) {
        const legal = game.legalActions(state, current);
        action = legal[Math.floor(Math.random() * legal.length)];
      }
      setThinking(false);
      feedback.move();
      apply(current, action);
    }, 450);
    return () => {
      clearTimeout(t);
      setThinking(false);
    };
  }, [session, outcome, current, botLevel, game, apply]);

  // Передача устройства: когда ход перешёл от одного человека к другому.
  const prevSeat = useRef<number | undefined>(current);
  useEffect(() => {
    if (cfg.hiddenInfo && current !== undefined && prevSeat.current !== undefined && current !== prevSeat.current && !botLevel) {
      setHandover(current);
    }
    prevSeat.current = current;
  }, [current, cfg.hiddenInfo, botLevel]);

  const humanSeat = current !== undefined && !botLevel ? current : (Object.keys(cfg.bots ?? {}).length ? [...Array(cfg.players).keys()].find((s) => !cfg.bots?.[s]) ?? 0 : 0);
  const viewSeat = humanSeat;
  const myTurn = current !== undefined && !botLevel && !thinking;

  return {
    view: game.view(session.state, viewSeat),
    legal: myTurn ? game.legalActions(session.state, viewSeat) : [],
    outcome,
    currentSeats: seats,
    viewSeat,
    myTurn,
    thinking,
    error,
    handover,
    ackHandover: () => setHandover(null),
    act: (action: unknown) => myTurn && apply(viewSeat, action),
    restart: () => {
      store.delete(cfgRef.current.saveKey);
      setSession(startSession(cfgRef.current.slug, { players: cfgRef.current.players, seed: randomSeed() }));
      setError(null);
      setHandover(null);
    },
  };
}
