import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createClerkClient, verifyToken } from '@clerk/backend';
import { AuthProvider, type User } from '@prisma/client';
import { PrismaService } from '../../common/prisma.module';

type ClerkUser = Awaited<ReturnType<ReturnType<typeof createClerkClient>['users']['getUser']>>;

const PROVIDER_MAP: Record<string, AuthProvider> = {
  oauth_google: AuthProvider.GOOGLE,
  oauth_apple: AuthProvider.APPLE,
  oauth_custom_vk: AuthProvider.VK,
  google: AuthProvider.GOOGLE,
  apple: AuthProvider.APPLE,
  custom_vk: AuthProvider.VK,
};

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);
  private readonly clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Проверяет JWT от Clerk (подпись, срок, издатель) и возвращает локального пользователя.
   * Используется и HTTP-гвардом, и Socket.io-мидлваром.
   */
  async authenticate(token: string): Promise<User> {
    if (token.startsWith('dev:')) return this.authenticateDev(token.slice(4));
    let clerkId: string;
    try {
      const payload = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY,
        issuer: process.env.CLERK_JWT_ISSUER || undefined,
      });
      clerkId = payload.sub;
    } catch {
      throw new UnauthorizedException('Сессия недействительна. Войдите заново.');
    }

    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (user) return this.assertActive(user);
    return this.assertActive(await this.provision(clerkId));
  }

  /**
   * Локальный режим без Clerk: токен `dev:<ник>`. Включён при DEV_AUTH=true либо когда не задан CLERK_SECRET_KEY
   * вне production. В production без явного DEV_AUTH=true токены такого вида отвергаются.
   */
  static devAuthEnabled(): boolean {
    if (process.env.DEV_AUTH === 'true') return true;
    if (process.env.DEV_AUTH === 'false') return false;
    return !process.env.CLERK_SECRET_KEY && process.env.NODE_ENV !== 'production';
  }

  private async authenticateDev(nick: string): Promise<User> {
    if (!AuthService.devAuthEnabled()) throw new UnauthorizedException('Сессия недействительна. Войдите заново.');
    if (!/^[A-Za-z0-9_]{3,16}$/.test(nick)) throw new UnauthorizedException('Ник: 3–16 латинских букв, цифр или «_».');
    const clerkId = `dev_${nick.toLowerCase()}`;
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (user) return this.assertActive(user);
    try {
      return await this.prisma.user.create({
        data: {
          clerkId,
          username: nick.toLowerCase(),
          displayName: nick,
          settings: { create: {} },
          wallet: { create: { coins: 500 } },
        },
      });
    } catch (e: unknown) {
      if ((e as { code?: string }).code !== 'P2002') throw e;
      const existing = await this.prisma.user.findUnique({ where: { clerkId } });
      if (existing) return existing;
      throw new UnauthorizedException('Ник уже занят.');
    }
  }

  private assertActive(user: User): User {
    if (user.status === 'DELETED') throw new UnauthorizedException('Аккаунт удалён.');
    if (user.status === 'BANNED' && (!user.bannedUntil || user.bannedUntil > new Date())) {
      throw new UnauthorizedException('Аккаунт заблокирован.');
    }
    return user;
  }

  /** Лениво создаёт профиль при первом входе (вебхук Clerk — резервный путь). */
  async provision(clerkId: string, known?: ClerkUser): Promise<User> {
    const cu = known ?? (await this.clerk.users.getUser(clerkId));
    const email = cu.primaryEmailAddress?.emailAddress ?? cu.emailAddresses[0]?.emailAddress ?? null;
    const displayName =
      [cu.firstName, cu.lastName].filter(Boolean).join(' ') || cu.username || email?.split('@')[0] || 'Игрок';
    const base = (cu.username ?? email?.split('@')[0] ?? 'player').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16) || 'player';

    // Ник уникален: при коллизии добавляем случайный суффикс.
    for (let attempt = 0; attempt < 5; attempt++) {
      const username = attempt === 0 ? base.padEnd(3, '_') : `${base}${Math.floor(1000 + Math.random() * 9000)}`;
      try {
        return await this.prisma.user.create({
          data: {
            clerkId,
            username,
            displayName: displayName.slice(0, 48),
            email,
            avatarUrl: cu.imageUrl,
            settings: { create: {} },
            wallet: { create: { coins: 500 } }, // стартовый бонус
            providers: {
              create: cu.externalAccounts.map((a) => ({
                provider: PROVIDER_MAP[a.provider] ?? AuthProvider.EMAIL,
                externalId: a.providerUserId ?? a.id,
              })),
            },
          },
        });
      } catch (e: unknown) {
        const code = (e as { code?: string }).code;
        if (code !== 'P2002') throw e;
        // Гонка: профиль уже создан параллельным запросом.
        const existing = await this.prisma.user.findUnique({ where: { clerkId } });
        if (existing) return existing;
      }
    }
    this.log.error(`Не удалось создать профиль для ${clerkId}`);
    throw new UnauthorizedException('Не удалось создать профиль.');
  }

  /** Удаляет учётную запись во внешнем провайдере (Clerk). Ошибки не критичны: локальные данные уже обезличены. */
  async deleteExternal(clerkId: string): Promise<void> {
    if (clerkId.startsWith('dev_') || !process.env.CLERK_SECRET_KEY) return;
    await this.clerk.users.deleteUser(clerkId).catch((e) => this.log.warn(`Clerk deleteUser: ${String(e)}`));
  }

  async markDeleted(clerkId: string): Promise<void> {
    await this.prisma.user.updateMany({
      where: { clerkId },
      data: { status: 'DELETED', email: null, avatarUrl: null },
    });
  }
}
