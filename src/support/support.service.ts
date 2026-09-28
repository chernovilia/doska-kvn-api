import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { adminUserIds } from '../auth/admin-check';

export const SUPPORT_TOPICS = ['question', 'problem', 'complaint', 'idea'] as const;
const TOPIC_LABEL: Record<string, string> = {
  question: 'Вопрос',
  problem: 'Проблема',
  complaint: 'Жалоба на пользователя',
  idea: 'Предложение'
};

const MESSAGES = { orderBy: { createdAt: 'asc' as const } };

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService
  ) {}

  // Заблокированные тоже могут писать: поддержка — место, где обжалуют блокировку.
  async create(userId: string, dto: { topic: string; text: string }) {
    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId,
        topic: dto.topic,
        messages: { create: { text: dto.text.trim() } }
      },
      include: { messages: MESSAGES }
    });
    await this.notifyAdmins(userId, ticket.id, TOPIC_LABEL[dto.topic], dto.text, true);
    return ticket;
  }

  async listMine(userId: string) {
    const items = await this.prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: { messages: MESSAGES }
    });
    return { items };
  }

  async addMessage(userId: string, ticketId: string, text: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.userId !== userId) throw new NotFoundException('Ticket not found');
    const message = await this.prisma.supportMessage.create({ data: { ticketId, text: text.trim() } });
    // Новое сообщение пользователя снова ставит обращение в очередь.
    await this.prisma.supportTicket.update({ where: { id: ticketId }, data: { status: 'open' } });
    await this.notifyAdmins(userId, ticketId, TOPIC_LABEL[ticket.topic], text, false);
    return message;
  }

  // ── Админка ──

  async adminList(status?: string) {
    const where = status && ['open', 'answered', 'closed'].includes(status) ? { status } : {};
    const items = await this.prisma.supportTicket.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 200,
      include: {
        messages: MESSAGES,
        user: { select: { id: true, name: true, email: true, avatar: true, blockedAt: true } }
      }
    });
    return { items };
  }

  async adminReply(ticketId: string, text: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.status === 'closed') throw new ForbiddenException('Обращение закрыто — откройте его заново');
    const message = await this.prisma.supportMessage.create({
      data: { ticketId, text: text.trim(), fromAdmin: true }
    });
    await this.prisma.supportTicket.update({ where: { id: ticketId }, data: { status: 'answered' } });
    await this.notifications.notify(ticket.userId, {
      type: 'support_reply',
      title: 'Поддержка ответила на ваше обращение',
      body: text.trim(),
      link: '/help',
      cta: 'Открыть обращение'
    });
    return message;
  }

  async adminSetStatus(ticketId: string, status: string) {
    if (!['open', 'answered', 'closed'].includes(status)) throw new ForbiddenException('Bad status');
    return this.prisma.supportTicket.update({ where: { id: ticketId }, data: { status }, select: { id: true, status: true } });
  }

  private async notifyAdmins(userId: string, ticketId: string, topic: string, text: string, isNew: boolean) {
    const [author, admins] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
      adminUserIds(this.prisma)
    ]);
    const who = author?.name || author?.email || 'Пользователь';
    for (const adminId of admins) {
      if (adminId === userId) continue;
      await this.notifications.notify(adminId, {
        type: 'support_new',
        title: isNew ? `Новое обращение: ${topic}` : `Новое сообщение в обращении: ${topic}`,
        body: `${who}: ${text.trim()}`,
        link: `/admin?tab=support&ticket=${ticketId}`,
        cta: 'Ответить'
      });
    }
  }
}
