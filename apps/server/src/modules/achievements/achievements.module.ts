import { Controller, Get, Global, Module } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators';
import type { AuthUser } from '../auth/auth.types';
import { AchievementsService } from './achievements.service';

@Controller('achievements')
class AchievementsController {
  constructor(private readonly achievements: AchievementsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.achievements.list(u.id);
  }
}

@Global()
@Module({ controllers: [AchievementsController], providers: [AchievementsService], exports: [AchievementsService] })
export class AchievementsModule {}
