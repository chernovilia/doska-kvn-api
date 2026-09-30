import { Injectable, Logger } from '@nestjs/common';
import { EmailSender } from './email-sender.interface';
import { renderAuthCodeEmail, renderNewMessageEmail, renderNotificationEmail } from './email-template';

/**
 * Реализация EmailSender через Unisender Go API.
 * Документация: https://godocs.unisender.ru/web-api-ref
 */
const SITE_URL = process.env.FRONTEND_URL || 'https://xn----7sbhf4acwc1a.xn--p1ai';

@Injectable()
export class UnisenderGoSender implements EmailSender {
  private readonly logger = new Logger(UnisenderGoSender.name);
  private readonly endpoint =
    'https://goapi.unisender.ru/ru/transactional/api/v1/email/send.json';

  private readonly apiKey = process.env.UNISENDER_GO_API_KEY || '';
  private readonly senderEmail =
    process.env.UNISENDER_GO_SENDER_EMAIL || 'noreply@doska-kvn.ru';
  private readonly senderName =
    process.env.UNISENDER_GO_SENDER_NAME || 'Доска/КВН';

  async sendAuthCode(params: {
    to: string;
    code: string;
    expiresInMin: number;
  }): Promise<void> {
    if (!this.apiKey) {
      // Dev-режим без ключа: печатаем код в лог. Позволяет тестировать локально.
      this.logger.warn(
        `UNISENDER_GO_API_KEY не задан — код для ${params.to}: ${params.code}`
      );
      return;
    }

    await this.send(
      params.to,
      renderAuthCodeEmail({ code: params.code, expiresInMin: params.expiresInMin }),
      'auth code'
    );
  }

  async sendNewMessage(params: {
    to: string;
    senderName: string;
    adTitle: string;
    preview: string;
    url: string;
  }): Promise<void> {
    if (!this.apiKey) {
      this.logger.warn(`UNISENDER_GO_API_KEY не задан — письмо о сообщении для ${params.to} не отправлено`);
      return;
    }
    await this.send(params.to, renderNewMessageEmail(params), 'new message');
  }

  async sendNotification(params: {
    to: string;
    title: string;
    body?: string | null;
    url: string;
    cta: string;
  }): Promise<void> {
    if (!this.apiKey) {
      this.logger.warn(`UNISENDER_GO_API_KEY не задан — уведомление для ${params.to} не отправлено`);
      return;
    }
    await this.send(params.to, renderNotificationEmail(params), 'notification');
  }

  private async send(
    to: string,
    { html, plaintext, subject }: { html: string; plaintext: string; subject: string },
    kind: string
  ): Promise<void> {
    const payload = {
      message: {
        recipients: [{ email: to }],
        subject,
        from_email: this.senderEmail,
        from_name: this.senderName,
        body: { html, plaintext },
        // Без трекеров: транзакционные письма не нужно засорять пикселями
        track_links: 0,
        track_read: 0,
        // Код входа — без List-Unsubscribe: по этому заголовку Mail.ru и другие относят письмо
        // к рассылкам (папка «Рассылки»), а код должен прийти во «Входящие».
        // Уведомления — со ссылкой на настройки, где почту можно отключить.
        ...(kind === 'auth code'
          ? {}
          : { headers: { 'List-Unsubscribe': `<${SITE_URL}/profile?tab=settings>` } })
      }
    };

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': this.apiKey
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Unisender ${res.status}: ${text}`);
      }

      const data = (await res.json()) as { job_id?: string; status?: string };
      this.logger.log(`Sent ${kind} to ${to}, job_id=${data.job_id || '?'}`);
    } catch (err) {
      this.logger.error(`Failed to send ${kind} to ${to}`, err as Error);
      throw err;
    }
  }
}
