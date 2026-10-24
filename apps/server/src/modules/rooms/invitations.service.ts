import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DomainEvents } from '../../common/events.module';
import { PrismaService } from '../../common/prisma.module';
import { areFriends, isBlockedBetween, userBrief } from '../../common/social';
import { RoomsService } from './rooms.service';

const INVITE_TTL_MS = 10 * 60_000;

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly events: DomainEvents,
  ) {}

  async create(senderId: string, code: string, receiverId: string) {
    if (senderId === receiverId) throw new BadRequestException('Нельзя пригласить себя');
    const room = await this.prisma.room.findUnique({
      where: { code: code.toUpperCase() },
      include: { players: true, game: { select: { title: true } }, host: { select: { displayName: true } } },
    });
    if (!room || room.status !== 'WAITING') throw new NotFoundException('Комната не найдена');
    if (!room.players.some((p) => p.userId === senderId)) throw new ForbiddenException('Вы не в этой комнате');
    if (room.players.length >= room.maxPlayers) throw new ConflictException('Комната заполнена');

    const receiver = await this.prisma.user.findFirst({
      where: { id: receiverId, status: 'ACTIVE' },
      include: { settings: true },
    });
    if (!receiver) throw new NotFoundException('Игрок не найден');
    if (await isBlockedBetween(this.prisma, senderId, receiverId)) throw new ForbiddenException('Приглашение недоступно');

    // Уважаем приватность получателя.
    const scope = receiver.settings?.allowInvitesFrom ?? 'FRIENDS';
    if (scope === 'NOBODY' || (scope === 'FRIENDS' && !(await areFriends(this.prisma, senderId, receiverId)))) {
      throw new ForbiddenException('Игрок не принимает приглашения от вас');
    }

    const sender = await this.prisma.user.findUniqueOrThrow({ where: { id: senderId }, select: { displayName: true } });
    const inv = await this.prisma.$transaction(async (tx) => {
      const created = await tx.invitation.create({
        data: { roomId: room.id, senderId, receiverId, expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
      });
      await tx.notification.create({
        data: {
          userId: receiverId,
          type: 'ROOM_INVITE',
          title: `${sender.displayName} зовёт вас играть`,
          body: `Игра: ${room.game.title}. Код комнаты: ${room.code}`,
          data: { invitationId: created.id, roomCode: room.code },
        },
      });
      return created;
    });
    this.events.emit({ type: 'invitation.created', receiverId, invitationId: inv.id });
    return inv;
  }

  listForUser(userId: string) {
    return this.prisma.invitation.findMany({
      where: { receiverId: userId, status: 'PENDING', expiresAt: { gt: new Date() } },
      include: {
        sender: { select: userBrief },
        room: { select: { code: true, game: { select: { slug: true, title: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async pending(userId: string, id: string) {
    const inv = await this.prisma.invitation.findUnique({ where: { id }, include: { room: { select: { code: true } } } });
    if (!inv || inv.receiverId !== userId) throw new NotFoundException('Приглашение не найдено');
    if (inv.status !== 'PENDING') throw new ConflictException('Приглашение уже обработано');
    if (inv.expiresAt < new Date()) {
      await this.prisma.invitation.update({ where: { id }, data: { status: 'EXPIRED' } });
      throw new ConflictException('Срок приглашения истёк');
    }
    return inv;
  }

  async accept(userId: string, id: string) {
    const inv = await this.pending(userId, id);
    // Приглашённый входит без пароля и проверки «только друзья».
    const room = await this.rooms.join(userId, inv.room.code, undefined, true);
    await this.prisma.invitation.update({ where: { id }, data: { status: 'ACCEPTED' } });
    return room;
  }

  async decline(userId: string, id: string) {
    await this.pending(userId, id);
    await this.prisma.invitation.update({ where: { id }, data: { status: 'DECLINED' } });
    return { ok: true };
  }
}
