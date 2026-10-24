import { Injectable, Logger } from '@nestjs/common';
import type { NotificationType, Prisma } from '@prisma/client';
import { PresenceService } from '../../common/presence.service';
import { PrismaService } from '../../common/prisma.module';
import { PushSender } from './push.sender';

type SettingFlag = 'pushFriendInvite' | 'pushYourTurn' | 'pushTournament';
const FLAG: Partial<Record<NotificationType, SettingFlag>> = {
  FRIEND_REQUEST: 'pushFriendInvite',
  FRIEND_ACCEPTED: 'pushFriendInvite',
  ROOM_INVITE: 'pushFriendInvite',
  YOUR_TURN: 'pushYourTurn',
  TOURNAMENT_START: 'pushTournament',
};

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body: string;
  data?: Prisma.InputJsonValue;
  /** Не слать push, если пользователь сейчас в приложении (по умолчанию — не слать). */
  pushWhenOnline?: boolean;
}

@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly push: PushSender,
  ) {}

  /** Сохраняет уведомление в центре уведомлений и (если разрешено настройками) отправляет push. */
  async notify(userId: string, n: NotifyInput) {
    const row = await this.prisma.notification.create({
      data: { userId, type: n.type, title: n.title, body: n.body, data: n.data },
    });
    await this.sendPush(userId, n).catch((e) => this.log.warn(`push: ${(e as Error).message}`));
    return row;
  }

  /** Только push, без записи в центр уведомлений (например «Ваш ход»). */
  async pushOnly(userId: string, n: NotifyInput) {
    await this.sendPush(userId, n).catch((e) => this.log.warn(`push: ${(e as Error).message}`));
  }

  private async sendPush(userId: string, n: NotifyInput) {
    if (!n.pushWhenOnline && (await this.presence.isOnline(userId))) return;
    const settings = await this.prisma.userSettings.findUnique({ where: { userId } });
    if (settings && !settings.pushEnabled) return;
    const flag = FLAG[n.type];
    if (settings && flag && !settings[flag]) return;

    const devices = await this.prisma.device.findMany({ where: { userId }, select: { pushToken: true } });
    if (devices.length === 0) return;
    const dead = await this.push.send(
      devices.map((d) => ({ to: d.pushToken, title: n.title, body: n.body, data: { type: n.type, ...((n.data as object) ?? {}) } })),
    );
    if (dead.length) await this.prisma.device.deleteMany({ where: { pushToken: { in: dead } } });
  }

  list(userId: string) {
    return this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  unreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, ids?: string[]) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }
}
