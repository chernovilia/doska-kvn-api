import { BadRequestException, Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { OptionalJwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

const PLATFORMS = ['ios', 'android', 'desktop'];
// Воронка окна установки и пушей — только эти события.
export const APP_EVENTS = [
  'install_prompt_shown', // показали окно-гайд
  'install_clicked', // нажали «Установить» (Android/Chrome — системное окно)
  'install_accepted', // системное окно: «Установить»
  'install_dismissed', // «Не показывать» или крестик в окне
  'banner_clicked', // «Установить» в баннере
  'banner_closed', // крестик баннера
  'push_prompt_shown', // предложили включить уведомления
  'push_enabled' // включили уведомления
] as const;

// Сегодняшняя дата по Москве — день для счётчиков.
function moscowDay(): Date {
  const d = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
  return new Date(`${d}T00:00:00Z`);
}

/**
 * Метрики приложения (PWA). Удаление приложения браузер не сообщает — поэтому считаем
 * «установлено» по первому открытию с иконки (на iPhone другого способа нет),
 * а на Android/Chrome ещё и по событию appinstalled.
 */
@Controller('app')
export class PwaController {
  constructor(private readonly prisma: PrismaService) {}

  @UseGuards(OptionalJwtAuthGuard)
  @Post('open')
  @HttpCode(200)
  async open(
    @Req() req: { userId?: string },
    @Body() body: { deviceId?: string; platform?: string; browser?: string; source?: string }
  ) {
    const id = body?.deviceId;
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new BadRequestException('deviceId');
    const platform = PLATFORMS.includes(body.platform || '') ? body.platform! : 'desktop';
    const browser = typeof body.browser === 'string' ? body.browser.slice(0, 20) : null;
    const source = body.source === 'appinstalled' ? 'appinstalled' : 'standalone';
    const now = new Date();
    await this.prisma.appDevice.upsert({
      where: { id },
      create: { id, userId: req.userId ?? null, platform, browser, source, installedAt: now, lastOpenAt: now },
      update: {
        lastOpenAt: now,
        // appinstalled приходит один раз при установке — это не открытие
        ...(source === 'standalone' ? { opens: { increment: 1 } } : {}),
        ...(req.userId ? { userId: req.userId } : {})
      }
    });
    if (source === 'appinstalled') await this.count('install_accepted');
    return { ok: true };
  }

  @Post('event')
  @HttpCode(200)
  async event(@Body() body: { name?: string }) {
    if (!APP_EVENTS.includes(body?.name as (typeof APP_EVENTS)[number])) throw new BadRequestException('event');
    await this.count(body.name!);
    return { ok: true };
  }

  private async count(name: string) {
    const day = moscowDay();
    await this.prisma.appEventDaily.upsert({
      where: { day_name: { day, name } },
      create: { day, name, count: 1 },
      update: { count: { increment: 1 } }
    });
  }
}
