import type { User } from '@prisma/client';

/** Пользователь, прикреплённый к запросу после успешной проверки JWT. */
export type AuthUser = User;

declare module 'http' {
  interface IncomingMessage {
    user?: AuthUser;
  }
}
