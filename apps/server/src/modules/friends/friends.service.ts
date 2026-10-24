import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DomainEvents } from '../../common/events.module';
import { PresenceService } from '../../common/presence.service';
import { PrismaService } from '../../common/prisma.module';
import { isBlockedBetween, userBrief } from '../../common/social';
import { AchievementsService } from '../achievements/achievements.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class FriendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly notifications: NotificationsService,
    private readonly events: DomainEvents,
    private readonly achievements: AchievementsService,
  ) {}

  async friendIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.friendship.findMany({
      where: { status: 'ACCEPTED', OR: [{ requesterId: userId }, { addresseeId: userId }] },
      select: { requesterId: true, addresseeId: true },
    });
    return rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId));
  }

  async request(meId: string, target: { userId?: string; username?: string }) {
    const other = await this.prisma.user.findFirst({
      where: { status: 'ACTIVE', ...(target.userId ? { id: target.userId } : { username: (target.username ?? '').toLowerCase() }) },
      select: userBrief,
    });
    if (!other) throw new NotFoundException('Игрок не найден');
    if (other.id === meId) throw new BadRequestException('Нельзя добавить в друзья себя');
    if (await isBlockedBetween(this.prisma, meId, other.id)) throw new ForbiddenException('Заявка недоступна');

    const existing = await this.prisma.friendship.findFirst({
      where: { OR: [{ requesterId: meId, addresseeId: other.id }, { requesterId: other.id, addresseeId: meId }] },
    });
    if (existing?.status === 'ACCEPTED') throw new ConflictException('Вы уже друзья');
    if (existing?.status === 'PENDING') {
      if (existing.requesterId === meId) throw new ConflictException('Заявка уже отправлена');
      return this.accept(meId, existing.id); // встречная заявка = согласие
    }

    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: meId }, select: { displayName: true } });
    // Если ранее заявку отклонили — переоткрываем ту же запись, иначе создаём новую.
    const mine = existing && existing.requesterId === meId ? existing : null;
    const friendship = mine
      ? await this.prisma.friendship.update({ where: { id: mine.id }, data: { status: 'PENDING', respondedAt: null } })
      : await this.prisma.friendship.create({ data: { requesterId: meId, addresseeId: other.id } });
    await this.notifications.notify(other.id, {
      type: 'FRIEND_REQUEST',
      title: 'Новая заявка в друзья',
      body: `${me.displayName} хочет добавить вас в друзья`,
      data: { friendshipId: friendship.id, userId: meId },
    });
    return friendship;
  }

  async accept(meId: string, friendshipId: string) {
    const f = await this.prisma.friendship.findFirst({ where: { id: friendshipId, addresseeId: meId, status: 'PENDING' } });
    if (!f) throw new NotFoundException('Заявка не найдена');
    const updated = await this.prisma.friendship.update({ where: { id: f.id }, data: { status: 'ACCEPTED', respondedAt: new Date() } });
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: meId }, select: { displayName: true } });
    await this.notifications.notify(f.requesterId, {
      type: 'FRIEND_ACCEPTED',
      title: 'Заявка принята',
      body: `${me.displayName} теперь ваш друг`,
      data: { userId: meId },
    });
    void this.achievements.evaluate(meId).catch(() => undefined);
    void this.achievements.evaluate(f.requesterId).catch(() => undefined);
    return updated;
  }

  async decline(meId: string, friendshipId: string) {
    const r = await this.prisma.friendship.updateMany({
      where: { id: friendshipId, addresseeId: meId, status: 'PENDING' },
      data: { status: 'DECLINED', respondedAt: new Date() },
    });
    if (r.count === 0) throw new NotFoundException('Заявка не найдена');
    return { ok: true };
  }

  /** Удаление из друзей или отмена своей исходящей заявки. */
  async remove(meId: string, otherId: string) {
    await this.prisma.friendship.deleteMany({
      where: { OR: [{ requesterId: meId, addresseeId: otherId }, { requesterId: otherId, addresseeId: meId }] },
    });
    return { ok: true };
  }

  async list(meId: string) {
    const rows = await this.prisma.friendship.findMany({
      where: { status: { in: ['ACCEPTED', 'PENDING'] }, OR: [{ requesterId: meId }, { addresseeId: meId }] },
      include: { requester: { select: { ...userBrief, lastSeenAt: true } }, addressee: { select: { ...userBrief, lastSeenAt: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const accepted = rows.filter((r) => r.status === 'ACCEPTED');
    const otherOf = (r: (typeof rows)[number]) => (r.requesterId === meId ? r.addressee : r.requester);
    const ids = accepted.map((r) => otherOf(r).id);
    const [statuses, unread] = await Promise.all([
      this.presence.statuses(ids),
      this.prisma.chatMessage.groupBy({
        by: ['senderId'],
        where: { scope: 'DIRECT', recipientId: meId, readAt: null, senderId: { in: ids } },
        _count: true,
      }),
    ]);
    const unreadBy = new Map(unread.map((u) => [u.senderId, u._count]));
    const friends = accepted
      .map((r) => {
        const u = otherOf(r);
        return { friendshipId: r.id, user: u, status: statuses.get(u.id) ?? 'offline', unread: unreadBy.get(u.id) ?? 0 };
      })
      .sort((a, b) => Number(b.status !== 'offline') - Number(a.status !== 'offline') || a.user.displayName.localeCompare(b.user.displayName, 'ru'));
    return {
      friends,
      incoming: rows.filter((r) => r.status === 'PENDING' && r.addresseeId === meId).map((r) => ({ friendshipId: r.id, user: r.requester })),
      outgoing: rows.filter((r) => r.status === 'PENDING' && r.requesterId === meId).map((r) => ({ friendshipId: r.id, user: r.addressee })),
    };
  }

  // ───────── блокировки ─────────

  async block(meId: string, targetId: string) {
    if (meId === targetId) throw new BadRequestException('Нельзя заблокировать себя');
    await this.prisma.$transaction([
      this.prisma.block.upsert({ where: { blockerId_blockedId: { blockerId: meId, blockedId: targetId } }, create: { blockerId: meId, blockedId: targetId }, update: {} }),
      this.prisma.friendship.deleteMany({
        where: { OR: [{ requesterId: meId, addresseeId: targetId }, { requesterId: targetId, addresseeId: meId }] },
      }),
    ]);
    return { ok: true };
  }

  async unblock(meId: string, targetId: string) {
    await this.prisma.block.deleteMany({ where: { blockerId: meId, blockedId: targetId } });
    return { ok: true };
  }

  blocks(meId: string) {
    return this.prisma.block.findMany({ where: { blockerId: meId }, include: { blocked: { select: userBrief } } });
  }
}
