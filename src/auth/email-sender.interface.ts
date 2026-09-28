/**
 * Абстракция над отправителем e-mail.
 * Позволяет переключить провайдера (Unisender Go / Resend / Notisend) без правок в auth-логике.
 */
export interface EmailSender {
  sendAuthCode(params: {
    to: string;
    code: string;
    expiresInMin: number;
  }): Promise<void>;

  sendNewMessage(params: {
    to: string;
    senderName: string;
    adTitle: string;
    preview: string;
    url: string;
  }): Promise<void>;

  // Уведомление сервиса: «объявление опубликовано», «новый отзыв» и т.п.
  sendNotification(params: {
    to: string;
    title: string;
    body?: string | null;
    url: string;
    cta: string;
  }): Promise<void>;
}

export const EMAIL_SENDER_TOKEN = Symbol('EmailSender');
