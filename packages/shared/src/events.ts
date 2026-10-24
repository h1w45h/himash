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
