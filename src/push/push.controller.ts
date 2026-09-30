import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from './push.service';

const PLATFORMS = ['ios', 'android', 'desktop'];

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
    const p256dh = body?.keys?.p256dh;
    const auth = body?.keys?.auth;
    if (
      typeof endpoint !== 'string' ||
      !/^https:\/\/[^\s]{10,1000}$/.test(endpoint) ||
      typeof p256dh !== 'string' ||
      typeof auth !== 'string' ||
      p256dh.length > 200 ||
      auth.length > 100
    ) {
      throw new BadRequestException('Некорректная подписка');
    }
    const platform = PLATFORMS.includes(body.platform || '') ? body.platform! : null;
    const deviceId = typeof body.deviceId === 'string' && /^[0-9a-f-]{36}$/.test(body.deviceId) ? body.deviceId : null;
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
