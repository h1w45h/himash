import { Body, Controller, Get, Module, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/auth.decorators';
import type { AuthUser } from '../auth/auth.types';
import { parse } from '../users/users.controller';
import { ShopService } from './shop.service';
import { WalletService } from './wallet.service';

@Controller()
class ShopController {
  constructor(
    private readonly shop: ShopService,
    private readonly wallet: WalletService,
  ) {}

  @Get('shop/items')
  items(@CurrentUser() u: AuthUser) {
    return this.shop.list(u.id);
  }

  @Post('shop/items/:id/buy')
  buy(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.shop.buy(u.id, id);
  }

  @Post('shop/items/:id/equip')
  equip(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.shop.equip(u.id, id);
  }

  @Post('shop/unequip')
  unequip(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    return this.shop.unequip(u.id, parse(z.object({ type: z.enum(['AVATAR', 'BOARD_THEME', 'CARD_BACK', 'APP_THEME']) }), body).type);
  }

  @Get('wallet')
  getWallet(@CurrentUser() u: AuthUser) {
    return this.wallet.get(u.id);
  }

  @Post('wallet/daily')
  daily(@CurrentUser() u: AuthUser) {
    return this.wallet.claimDaily(u.id);
  }
}

@Module({ controllers: [ShopController], providers: [ShopService, WalletService], exports: [ShopService, WalletService] })
export class ShopModule {}
