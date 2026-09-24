/**
 * HTML-шаблон письма с кодом авторизации.
 * Максимально минималистичный, работает в Gmail/Mail.ru/Yandex.
 */
export function renderAuthCodeEmail(params: {
  code: string;
  expiresInMin: number;
  brandName?: string;
  brandUrl?: string;
}): { html: string; plaintext: string; subject: string } {
  const {
    code,
    expiresInMin,
    brandName = 'Доска/КВН',
    brandUrl = 'https://xn----7sbhf4acwc1a.xn--p1ai'
  } = params;

  const subject = `${code} — код для входа в ${brandName}`;

  const plaintext = [
    `Ваш код для входа: ${code}`,
    `Он действителен ${expiresInMin} минут.`,
    ``,
    `Если это не вы — просто проигнорируйте это письмо. Никто не сможет войти без кода.`,
    ``,
    `${brandName}`,
    brandUrl
  ].join('\n');

  const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <meta name="color-scheme" content="light dark">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f6f7fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px;">
    <div style="text-align:center;margin-bottom:24px;">
      <a href="${brandUrl}" style="text-decoration:none;color:#0f172a;font-weight:900;font-size:24px;letter-spacing:-0.5px;">
        Доска<span style="color:#f97316;">/</span>КВН
      </a>
    </div>

    <div style="background:#ffffff;border-radius:16px;padding:32px 24px;box-shadow:0 2px 10px -4px rgba(15,23,42,0.10);text-align:center;">
      <div style="font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:8px;">
        Код для входа
      </div>
      <div style="font-size:40px;font-weight:900;letter-spacing:8px;color:#4f46e5;margin:16px 0;font-variant-numeric:tabular-nums;">
        ${code}
      </div>
      <div style="font-size:13px;color:#64748b;">
        Действителен ${expiresInMin} минут
      </div>
    </div>

    <div style="margin-top:24px;padding:16px 20px;background:#fff7ed;border-radius:12px;font-size:13px;color:#7c2d12;line-height:1.5;">
      <b>Если это не вы</b> — просто проигнорируйте письмо. Без кода войти в аккаунт невозможно.
    </div>

    <div style="margin-top:32px;padding-top:20px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;line-height:1.6;text-align:center;">
      Городская платформа объявлений, услуг и афиши<br>
      агломерации Кулебаки • Выкса • Навашино<br>
      <a href="${brandUrl}" style="color:#4f46e5;text-decoration:none;">${brandUrl.replace(/^https?:\/\//, '')}</a>
    </div>
  </div>
</body>
</html>`;

  return { html, plaintext, subject };
}
