import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EMAIL_SENDER_TOKEN, EmailSender } from '../auth/email-sender.interface';

const SITE_URL = process.env.FRONTEND_URL || 'https://xn----7sbhf4acwc1a.xn--p1ai';

export type NotificationType = 'ad_approved' | 'ad_rejected' | 'ad_removed' | 'review_new';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_SENDER_TOKEN) private readonly email: EmailSender
  ) {}

  /**
   * Уведомление на сайте + письмо, если пользователь не отключил почту.
   * Письмо уходит фоном: сбой почты не должен ломать действие, которое уведомляет.
   */
  async notify(
    userId: string,
    n: { type: NotificationType; title: string; body?: string | null; link?: string | null; cta?: string }
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, notifyEmail: true }
    });
    if (!user) return;
    await this.prisma.notification.create({
      data: { userId, type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null }
    });
    if (user.notifyEmail && user.email) {
      this.email
        .sendNotification({
          to: user.email,
          title: n.title,
          body: n.body,
          url: `${SITE_URL}${n.link || '/'}`,
          cta: n.cta || 'Открыть'
        })
        .catch((err) => this.logger.warn(`Письмо-уведомление не ушло: ${err?.message || err}`));
    }
  }

  async list(userId: string) {
    const items = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    return { items };
  }

  async unreadCount(userId: string) {
    const count = await this.prisma.notification.count({ where: { userId, readAt: null } });
    return { count };
  }

  async markRead(userId: string, id: string) {
    const { count } = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() }
    });
    if (!count) {
      const exists = await this.prisma.notification.count({ where: { id, userId } });
      if (!exists) throw new NotFoundException('Notification not found');
    }
    return { ok: true };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() }
    });
    return { ok: true };
  }
}
