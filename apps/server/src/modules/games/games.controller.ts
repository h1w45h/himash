import { BadRequestException, Controller, Get, Header, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../auth/auth.decorators';
import { GamesService } from './games.service';

const filtersSchema = z.object({
  category: z.enum(['CLASSIC', 'CARD', 'STRATEGY', 'PARTY']).optional(),
  players: z.coerce.number().int().min(2).max(20).optional(),
  q: z.string().trim().max(50).optional(),
});

@Controller('games')
export class GamesController {
  constructor(private readonly games: GamesService) {}

  // Каталог публичный и редко меняется — разрешаем кэшировать на 5 минут.
  @Public()
  @Get()
  @Header('Cache-Control', 'public, max-age=300')
  list(@Query() query: unknown) {
    const r = filtersSchema.safeParse(query);
    if (!r.success) throw new BadRequestException('Неверные параметры фильтра');
    return this.games.list(r.data);
  }

  @Public()
  @Get(':slug')
  @Header('Cache-Control', 'public, max-age=300')
  get(@Param('slug') slug: string) {
    return this.games.get(slug);
  }

  @Get(':slug/leaderboard')
  leaderboard(@Param('slug') slug: string) {
    return this.games.leaderboard(slug);
  }
}
