import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';
import { countUnreadMessages } from '../chats/unread';

export type PushPayload = {
  title: string;
  body?: string | null;
  url?: string | null;
  // Одно уведомление на тег: новое сообщение в диалоге заменяет прошлое
  tag?: string;
};

/**
 * Web Push (VAPID). Ключи — env VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…).
 * Без ключей пуши выключены: сайт не предлагает их включить, отправка молча пропускается.
 * На iPhone пуши получает только установленное приложение (iOS 16.4+).
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger('Push');
  publicKey: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const pub = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    if (!pub || !priv) {
      this.logger.warn('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY не заданы — пуши выключены');
      return;
    }
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', pub, priv);
    this.publicKey = pub;
  }

  get enabled() {
    return !!this.publicKey;
  }

  // Фоном: сбой пушей не должен ломать действие, которое уведомляет.
  sendToUser(userId: string, payload: PushPayload) {
    if (!this.enabled) return;
    void this.deliver(userId, payload).catch((err) => this.logger.warn(`Пуш не ушёл: ${err?.message || err}`));
  }

  private async deliver(userId: string, payload: PushPayload) {
    const subs = await this.prisma.pushSubscription.findMany({ where: { userId } });
    if (!subs.length) return;
    const unread = await countUnreadMessages(this.prisma, userId);
    const body = JSON.stringify({ ...payload, unread });
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
            { TTL: 24 * 3600, urgency: 'high' }
          );
          await this.prisma.pushSubscription.update({ where: { id: s.id }, data: { lastOkAt: new Date() } });
        } catch (err: any) {
          // 404/410 — подписки больше нет (удалили приложение, отозвали разрешение)
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            await this.prisma.pushSubscription.deleteMany({ where: { id: s.id } });
          } else {
            this.logger.warn(`Пуш ${err?.statusCode || ''}: ${err?.body || err?.message || err}`);
          }
        }
      })
    );
  }
}
