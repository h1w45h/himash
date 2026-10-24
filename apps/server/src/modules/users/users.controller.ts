import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z, type ZodType, type ZodTypeDef } from 'zod';
import { CurrentUser } from '../auth/auth.decorators';
import type { AuthUser } from '../auth/auth.types';
import { UsersService, updateProfileSchema, updateSettingsSchema } from './users.service';

/** Разбор тела запроса через zod с русскими сообщениями об ошибках. */
export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message).join('; '));
  return r.data;
}

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.users.me(user.id);
  }

  @Patch('me')
  updateProfile(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.users.updateProfile(user.id, parse(updateProfileSchema, body));
  }

  @Patch('me/settings')
  updateSettings(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.users.updateSettings(user.id, parse(updateSettingsSchema, body));
  }

  @Post('me/devices')
  async registerDevice(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const dto = parse(z.object({ pushToken: z.string().min(10), platform: z.enum(['IOS', 'ANDROID']) }), body);
    await this.users.registerDevice(user.id, dto.pushToken, dto.platform);
    return { ok: true };
  }

  @Get('search')
  search(@CurrentUser() user: AuthUser, @Query('q') q = '') {
    if (q.trim().length < 2) throw new BadRequestException('Введите минимум 2 символа');
    return this.users.search(q.trim(), user.id);
  }

  @Get(':id')
  profile(@Param('id') id: string) {
    return this.users.publicProfile(id);
  }
}
