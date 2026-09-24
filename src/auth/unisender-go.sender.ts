import { Injectable, Logger } from '@nestjs/common';
import { EmailSender } from './email-sender.interface';
import { renderAuthCodeEmail } from './email-template';

/**
 * Реализация EmailSender через Unisender Go API.
 * Документация: https://godocs.unisender.ru/web-api-ref
 */
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

    const { html, plaintext, subject } = renderAuthCodeEmail({
      code: params.code,
      expiresInMin: params.expiresInMin
    });

    const payload = {
      message: {
        recipients: [{ email: params.to }],
        subject,
        from_email: this.senderEmail,
        from_name: this.senderName,
        body: { html, plaintext },
        // Отключаем трекеры — код авторизации не нужно засорять пикселями
        track_links: 0,
        track_read: 0,
        // Заголовок List-Unsubscribe помогает с deliverability на Mail.ru
        headers: {
          'List-Unsubscribe': `<mailto:${this.senderEmail}?subject=unsubscribe>`
        }
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
      this.logger.log(
        `Sent auth code to ${params.to}, job_id=${data.job_id || '?'}`
      );
    } catch (err) {
      this.logger.error(
        `Failed to send auth code to ${params.to}`,
        err as Error
      );
      throw err;
    }
  }
}
