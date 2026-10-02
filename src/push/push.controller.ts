import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Logger, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from './push.service';

const PLATFORMS = ['ios', 'android', 'desktop'];
// Сервер сам стучится по адресу подписки, поэтому принимаем только адреса настоящих служб
// уведомлений (Chrome/Android, Safari/iPhone, Firefox, Edge) — не произвольный сайт.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/
];
const MAX_SUBSCRIPTIONS_PER_USER = 10;

function allowedPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && !u.username && !u.port && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

@Controller('push')
export class PushController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService
  ) {}

  // Публичный ключ для pushManager.subscribe; null — пуши на сервере выключены.
  @Get('key')
  key() {
    return { key: this.push.publicKey };
  }

  @UseGuards(JwtAuthGuard)
  @Post('subscribe')
  @HttpCode(200)
  async subscribe(
    @CurrentUser() userId: string,
    @Body() body: { endpoint?: string; keys?: { p256dh?: string; auth?: string }; platform?: string; deviceId?: string }
  ) {
    const endpoint = body?.endpoint;
    if (typeof endpoint === 'string' && endpoint.startsWith('https://') && !allowedPushEndpoint(endpoint)) {
      // Незнакомая служба уведомлений: если это настоящий браузер — добавить его адрес в PUSH_HOSTS
      new Logger('Push').warn(`Подписка отклонена, незнакомый адрес: ${endpoint.slice(0, 60)}`);
    }
    const p256dh = body?.keys?.p256dh;
    const auth = body?.keys?.auth;
    if (
      typeof endpoint !== 'string' ||
      !/^https:\/\/[^\s]{10,1000}$/.test(endpoint) ||
      !allowedPushEndpoint(endpoint) ||
      typeof p256dh !== 'string' ||
      typeof auth !== 'string' ||
      p256dh.length > 200 ||
      auth.length > 100
    ) {
      throw new BadRequestException('Некорректная подписка');
    }
    const platform = PLATFORMS.includes(body.platform || '') ? body.platform! : null;
    const deviceId = typeof body.deviceId === 'string' && /^[0-9a-f-]{36}$/.test(body.deviceId) ? body.deviceId : null;
    // Потолок устройств на человека: самые старые подписки убираем.
    const extra = await this.prisma.pushSubscription.findMany({
      where: { userId, endpoint: { not: endpoint } },
      orderBy: { createdAt: 'desc' },
      skip: MAX_SUBSCRIPTIONS_PER_USER - 1,
      select: { id: true }
    });
    if (extra.length) {
      await this.prisma.pushSubscription.deleteMany({ where: { id: { in: extra.map((e) => e.id) } } });
    }
    // Тот же браузер после входа под другим аккаунтом — подписка переходит новому владельцу.
    await this.prisma.pushSubscription.upsert({
      where: { endpoint },
      update: { userId, p256dh, auth, platform, deviceId },
      create: { userId, endpoint, p256dh, auth, platform, deviceId }
    });
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Delete('subscribe')
  async unsubscribe(@CurrentUser() userId: string, @Body() body: { endpoint?: string }) {
    if (typeof body?.endpoint === 'string') {
      await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint: body.endpoint } });
    }
    return { ok: true };
  }
}
