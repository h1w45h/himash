import { z } from 'zod';

export const usernameSchema = z
  .string()
  .min(3, 'Минимум 3 символа')
  .max(24, 'Максимум 24 символа')
  .regex(/^[a-zA-Z0-9_]+$/, 'Только латиница, цифры и _');

export const createRoomSchema = z.object({
  gameSlug: z.string(),
  visibility: z.enum(['PUBLIC', 'PRIVATE', 'FRIENDS']).default('PUBLIC'),
  maxPlayers: z.number().int().min(2).max(12),
  variantKey: z.string().optional(),
  turnTimeSec: z.number().int().min(10).max(600).optional(),
  isRated: z.boolean().default(true),
  password: z.string().max(32).optional(),
});
export type CreateRoomDto = z.infer<typeof createRoomSchema>;

export const matchActionSchema = z.object({
  matchId: z.string(),
  expectedVersion: z.number().int().nonnegative(),
  action: z.unknown(),
});
export type MatchActionDto = z.infer<typeof matchActionSchema>;

export const joinRoomSchema = z.object({ password: z.string().max(32).optional() });

export const readySchema = z.object({ ready: z.boolean() });

export const addBotSchema = z.object({ level: z.enum(['EASY', 'MEDIUM', 'HARD', 'EXPERT']).default('MEDIUM') });

export const inviteSchema = z.object({ userId: z.string() });

export const matchmakingJoinSchema = z.object({
  gameSlug: z.string(),
  variantKey: z.string().optional(),
});
export type MatchmakingJoinDto = z.infer<typeof matchmakingJoinSchema>;

/** Состояние подбора соперника, которое видит клиент. */
export type MatchmakingStatus =
  | { state: 'idle' }
  | { state: 'searching'; gameSlug: string; waitedMs: number }
  | { state: 'found'; roomCode: string; matchId: string };

/** Нормализация кода комнаты: регистр и пробелы не важны. */
export const normalizeRoomCode = (code: string) => code.trim().toUpperCase();
