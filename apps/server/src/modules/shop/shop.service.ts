import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { ShopItemType } from '@prisma/client';
import { PrismaService } from '../../common/prisma.module';

const SETTING_BY_TYPE = { BOARD_THEME: 'activeBoardTheme', CARD_BACK: 'activeCardBack', APP_THEME: 'activeAppTheme' } as const;

@Injectable()
export class ShopService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const now = new Date();
    const [items, owned, settings, user] = await Promise.all([
      this.prisma.shopItem.findMany({
        where: {
          isActive: true,
          currency: 'COINS', // за кристаллы (IAP) — после подключения платежей
          AND: [{ OR: [{ availableFrom: null }, { availableFrom: { lte: now } }] }, { OR: [{ availableTo: null }, { availableTo: { gte: now } }] }],
        },
        orderBy: [{ type: 'asc' }, { price: 'asc' }],
      }),
      this.prisma.inventoryItem.findMany({ where: { userId }, select: { itemId: true } }),
      this.prisma.userSettings.findUnique({ where: { userId } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { avatarId: true } }),
    ]);
    const ownedSet = new Set(owned.map((o) => o.itemId));
    const equipped = new Set([user.avatarId, settings?.activeBoardTheme, settings?.activeCardBack, settings?.activeAppTheme].filter(Boolean));
    return items.map((i) => ({ ...i, owned: ownedSet.has(i.id), equipped: equipped.has(i.assetKey) }));
  }

  async buy(userId: string, itemId: string) {
    const item = await this.prisma.shopItem.findFirst({ where: { id: itemId, isActive: true } });
    if (!item) throw new NotFoundException('Предмет не найден');
    if (item.currency !== 'COINS') throw new BadRequestException('Этот предмет пока недоступен');
    try {
      await this.prisma.$transaction(async (tx) => {
        if (await tx.inventoryItem.findUnique({ where: { userId_itemId: { userId, itemId } } })) throw new ConflictException('Уже куплено');
        // Условное списание: если денег не хватает, строка не обновится — гонка двух покупок не уведёт баланс в минус.
        const paid = await tx.wallet.updateMany({ where: { userId, coins: { gte: item.price } }, data: { coins: { decrement: item.price } } });
        if (paid.count === 0) throw new BadRequestException('Недостаточно монет');
        await tx.inventoryItem.create({ data: { userId, itemId } });
        await tx.purchase.create({ data: { userId, itemId, currency: item.currency, price: item.price } });
        await tx.walletTransaction.create({
          data: { userId, currency: 'COINS', amount: -item.price, reason: 'SHOP_PURCHASE', refId: item.id, idempotencyKey: `purchase:${userId}:${item.id}` },
        });
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException('Уже куплено');
      throw e;
    }
    return { ok: true };
  }

  async equip(userId: string, itemId: string) {
    const inv = await this.prisma.inventoryItem.findUnique({ where: { userId_itemId: { userId, itemId } }, include: { item: true } });
    if (!inv) throw new BadRequestException('Сначала купите предмет');
    await this.apply(userId, inv.item.type, inv.item.assetKey);
    return { ok: true };
  }

  async unequip(userId: string, type: ShopItemType) {
    await this.apply(userId, type, null);
    return { ok: true };
  }

  private async apply(userId: string, type: ShopItemType, assetKey: string | null) {
    if (type === 'AVATAR') {
      await this.prisma.user.update({ where: { id: userId }, data: { avatarId: assetKey } });
      return;
    }
    const field = SETTING_BY_TYPE[type as keyof typeof SETTING_BY_TYPE];
    if (!field) throw new BadRequestException('Этот предмет нельзя применить');
    await this.prisma.userSettings.update({ where: { userId }, data: { [field]: assetKey } });
  }
}
