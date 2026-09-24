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
}

export const EMAIL_SENDER_TOKEN = Symbol('EmailSender');
