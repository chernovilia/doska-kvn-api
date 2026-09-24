import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EMAIL_SENDER_TOKEN, EmailSender } from './email-sender.interface';

const EMAIL_CODE_TTL_MIN = 15;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly intervalSec = Number(process.env.EMAIL_CODE_INTERVAL_SEC || 60);
  private readonly maxAttempts = Number(process.env.EMAIL_CODE_MAX_ATTEMPTS || 5);
  private readonly accessTtl = Number(process.env.JWT_ACCESS_TTL_SEC || 900);
  private readonly refreshTtl = Number(process.env.JWT_REFRESH_TTL_SEC || 7776000);
  private readonly accessSecret =
    process.env.JWT_ACCESS_SECRET || 'dev-access-secret-change-me';
  private readonly refreshSecret =
    process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me';

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(EMAIL_SENDER_TOKEN) private readonly emailSender: EmailSender
  ) {}

  // ── Utility ────────────────────────────────────────────────────

  private sha256(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex');
  }

  private generateNumericCode(len = 6): string {
    // Криптостойкий 6-значный код с ведущими нулями.
    const max = 10 ** len;
    const num = crypto.randomInt(0, max);
    return num.toString().padStart(len, '0');
  }

  // ── Public: запрос кода на email ───────────────────────────────

  async requestEmailCode(email: string, ctx: { ip?: string; ua?: string }) {
    // Rate limit по email: не чаще чем раз в EMAIL_CODE_INTERVAL_SEC.
    const recent = await this.prisma.emailCode.findFirst({
      where: { email, usedAt: null },
      orderBy: { createdAt: 'desc' }
    });
    if (recent) {
      const secSince = Math.floor(
        (Date.now() - recent.createdAt.getTime()) / 1000
      );
      const wait = this.intervalSec - secSince;
      if (wait > 0) {
        throw new BadRequestException({
          message: `Подождите ${wait} сек. перед повторной отправкой кода`,
          retryAfterSec: wait
        });
      }
    }

    const code = this.generateNumericCode(6);
    const codeHash = this.sha256(code);
    const expiresAt = new Date(Date.now() + EMAIL_CODE_TTL_MIN * 60_000);

    await this.prisma.emailCode.create({
      data: {
        email,
        codeHash,
        expiresAt,
        ip: ctx.ip,
        userAgent: ctx.ua
      }
    });

    try {
      await this.emailSender.sendAuthCode({
        to: email,
        code,
        expiresInMin: EMAIL_CODE_TTL_MIN
      });
    } catch (err) {
      // Не роняем весь запрос — фронт получит успех, юзер запросит повторно.
      // Но пишем warning для мониторинга.
      this.logger.warn(`Email send failed for ${email}: ${(err as Error).message}`);
    }

    return {
      ok: true,
      email,
      expiresInSec: EMAIL_CODE_TTL_MIN * 60,
      resendAfterSec: this.intervalSec
    };
  }

  // ── Public: проверка кода ──────────────────────────────────────

  async verifyEmailCode(
    email: string,
    code: string,
    ctx: { ip?: string; ua?: string }
  ) {
    const record = await this.prisma.emailCode.findFirst({
      where: { email, usedAt: null },
      orderBy: { createdAt: 'desc' }
    });

    if (!record) {
      throw new BadRequestException(
        'Код не запрашивался. Нажмите «Отправить код»'
      );
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException(
        'Код истёк. Запросите новый'
      );
    }
    if (record.attempts >= this.maxAttempts) {
      throw new BadRequestException(
        `Слишком много попыток. Запросите новый код`
      );
    }

    const isValid = this.sha256(code) === record.codeHash;

    // Считаем попытку в любом случае.
    await this.prisma.emailCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } }
    });

    if (!isValid) {
      const left = this.maxAttempts - record.attempts - 1;
      throw new BadRequestException(
        left > 0
          ? `Неверный код. Осталось попыток: ${left}`
          : 'Слишком много попыток. Запросите новый код'
      );
    }

    // Помечаем код как использованный.
    await this.prisma.emailCode.update({
      where: { id: record.id },
      data: { usedAt: new Date() }
    });

    // Найти или создать юзера. Аватар/имя оставляем пустыми — заполнит сам в профиле.
    let user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      const nameFromEmail = email.split('@')[0].replace(/[._-]/g, ' ');
      user = await this.prisma.user.create({
        data: {
          email,
          name: nameFromEmail.charAt(0).toUpperCase() + nameFromEmail.slice(1)
        }
      });
    } else {
      // Обновляем lastSeenAt.
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastSeenAt: new Date() }
      });
    }

    // Кошелёк создаём при первой авторизации, если нет.
    await this.prisma.wallet.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, balance: 10 }
    });

    // Генерим access + refresh пары.
    const tokens = await this.issueTokens(user.id, ctx);
    const fullUser = await this.me(user.id);
    return {
      ok: true,
      user: fullUser,
      ...tokens
    };
  }

  // ── Токены и refresh-ротация ───────────────────────────────────

  private async issueTokens(userId: string, ctx: { ip?: string; ua?: string }) {
    const jti = crypto.randomUUID();
    const accessToken = await this.jwt.signAsync(
      { sub: userId },
      {
        secret: this.accessSecret,
        expiresIn: this.accessTtl
      }
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, jti },
      {
        secret: this.refreshSecret,
        expiresIn: this.refreshTtl
      }
    );

    await this.prisma.refreshToken.create({
      data: {
        id: jti,
        userId,
        tokenHash: this.sha256(refreshToken),
        expiresAt: new Date(Date.now() + this.refreshTtl * 1000),
        ip: ctx.ip,
        userAgent: ctx.ua
      }
    });

    return {
      accessToken,
      refreshToken,
      accessTtlSec: this.accessTtl,
      refreshTtlSec: this.refreshTtl
    };
  }

  async refresh(oldToken: string, ctx: { ip?: string; ua?: string }) {
    let payload: { sub: string; jti: string };
    try {
      payload = await this.jwt.verifyAsync(oldToken, {
        secret: this.refreshSecret
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const record = await this.prisma.refreshToken.findUnique({
      where: { id: payload.jti }
    });
    if (
      !record ||
      record.revokedAt ||
      record.expiresAt.getTime() < Date.now() ||
      record.tokenHash !== this.sha256(oldToken)
    ) {
      throw new UnauthorizedException('Refresh token invalid or revoked');
    }

    // Ротация: новый токен, старый инвалидируем.
    const next = await this.issueTokens(record.userId, ctx);
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: {
        revokedAt: new Date(),
        replacedById: (await this.prisma.refreshToken.findFirst({
          where: { userId: record.userId },
          orderBy: { createdAt: 'desc' }
        }))?.id
      }
    });
    return next;
  }

  async logout(refreshToken?: string) {
    if (!refreshToken) return { ok: true };
    try {
      const payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.refreshSecret
      });
      await this.prisma.refreshToken.updateMany({
        where: { id: payload.jti, revokedAt: null },
        data: { revokedAt: new Date() }
      });
    } catch {
      // Игнорируем — токен уже недействителен.
    }
    return { ok: true };
  }

  async verifyAccessToken(token: string): Promise<{ userId: string }> {
    const payload = await this.jwt.verifyAsync(token, {
      secret: this.accessSecret
    });
    return { userId: payload.sub };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        businessProfile: true,
        wallet: true
      }
    });
    if (!user) throw new UnauthorizedException('User not found');
    return user;
  }
}
