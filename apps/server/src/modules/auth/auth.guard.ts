import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { IncomingMessage } from 'http';
import { IS_PUBLIC } from './auth.decorators';
import { AuthService } from './auth.service';

/** Глобальный гвард: все HTTP-эндпоинты требуют Bearer-токен, кроме помеченных @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true; // сокеты проверяются в мидлваре шлюза
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<IncomingMessage>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Требуется авторизация.');
    req.user = await this.auth.authenticate(header.slice(7));
    return true;
  }
}
