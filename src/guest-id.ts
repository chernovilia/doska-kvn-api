import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

// Анонимный id гостя для лимитов запросов. Настоящий IP до API не доходит: перед ингрессом
// Amvera стоит ещё один внутренний прокси, и во всех заголовках — его адрес 10.128.x.
// Без своего ключа все гости делили бы один лимит на сайт.
//
// gid ставим при первом запросе. Запрос, пришедший без gid (первый заход, боты без cookie),
// помечаем req.newGuest — лимит для него считается общим «анонимным» с запасом (см. AppThrottlerGuard).
const GID_RE = /^[0-9a-f-]{36}$/;
const cookieDomain = process.env.COOKIE_DOMAIN || undefined;
const cookieSecure = process.env.COOKIE_SECURE !== 'false';

export function guestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const current = req.cookies?.gid;
  if (typeof current === 'string' && GID_RE.test(current)) return next();
  const gid = randomUUID();
  res.cookie('gid', gid, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: 'lax',
    domain: cookieDomain,
    path: '/',
    maxAge: 365 * 24 * 3600 * 1000
  });
  (req as Request & { newGuest?: boolean }).newGuest = true;
  next();
}

export function validGid(value: unknown): string | null {
  return typeof value === 'string' && GID_RE.test(value) ? value : null;
}
