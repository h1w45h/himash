/** Имена событий Socket.io — единый источник для клиента и сервера. */
export const GameEvents = {
  RoomJoin: 'room:join',
  RoomLeave: 'room:leave',
  RoomReady: 'room:ready',
  RoomUpdated: 'room:updated',
  MatchAction: 'match:action',
  MatchUpdate: 'match:update',
  MatchTurn: 'match:turn',
  MatchResync: 'match:resync',
  MatchEnded: 'match:ended',
  MatchmakingJoin: 'mm:join',
  MatchmakingLeave: 'mm:leave',
  MatchmakingFound: 'mm:found',
  ChatSend: 'chat:send',
  ChatMessage: 'chat:message',
} as const;

export const SocialEvents = {
  PresenceUpdate: 'presence:update',
  Invite: 'invite:received',
  FriendRequest: 'friend:request',
} as const;

/** Ответ-подтверждение на любое действие клиента. */
export type Ack<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: 'STALE' | 'INVALID' | 'FORBIDDEN' | 'NOT_FOUND' | 'RATE_LIMIT'; message: string };

export class RealtimeError extends Error {
  constructor(
    public readonly code: Extract<Ack, { ok: false }>['code'],
    message: string,
  ) {
    super(message);
  }
}

export interface MatchPlayerInfo {
  seat: number;
  userId: string | null;
  displayName: string;
  avatarUrl: string | null;
  isBot: boolean;
  /** WIN | LOSS | DRAW | LEFT — только после окончания. */
  result: string | null;
  ratingDelta: number | null;
}

/** Полное состояние партии «глазами» одного места. Отправляется при входе и реконнекте. */
export interface MatchSnapshot {
  matchId: string;
  gameSlug: string;
  variantKey: string | null;
  roomCode: string | null;
  status: 'IN_PROGRESS' | 'FINISHED' | 'ABANDONED' | 'CANCELLED';
  /** Моё место; null — наблюдатель. */
  seat: number | null;
  version: number;
  view: unknown;
  /** Допустимые действия (только если сейчас мой ход). */
  legal: unknown[];
  currentSeats: number[];
  turnDeadline: string | null;
  players: MatchPlayerInfo[];
  outcome: { winners: number[]; ranking: number[]; reason: string; scores?: Record<number, number> } | null;
}

/** Инкремент после хода. `action` уже обработан через redactAction. */
export interface MatchUpdate extends Omit<MatchSnapshot, 'variantKey' | 'roomCode' | 'gameSlug'> {
  lastAction: { seat: number; action: unknown } | null;
}

export interface ChatMessageDto {
  id: string;
  scope: 'ROOM' | 'MATCH' | 'DIRECT' | 'TOURNAMENT';
  recipientId: string | null;
  body: string;
  createdAt: string;
  sender: { id: string; username: string; displayName: string; avatarUrl: string | null } | null;
}

export type PresenceStatusDto = 'online' | 'playing' | 'offline';
export interface PresenceUpdate {
  userId: string;
  status: PresenceStatusDto;
}
