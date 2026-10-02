import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { APP_TEXTS_KEY, CONTACTS_KEY, NEIGHBORS_KEY, SiteContacts, readJsonSetting } from '../settings/json-settings';
import { MANAGED_SETTINGS } from '../settings/managed-settings';

@Controller()
export class RegionsController {
  constructor(private readonly prisma: PrismaService) {}

  // Публичные настройки сайта из админки: соседние города, контакты для подвала,
  // правила и тексты окон приложения. Без секретов — отдаётся всем.
  @Get('site')
  async site() {
    const appKeys = Object.keys(MANAGED_SETTINGS).filter((k) => k.startsWith('app.'));
    const [neighbors, contacts, texts, rows] = await Promise.all([
      readJsonSetting<Record<string, string[]>>(this.prisma, NEIGHBORS_KEY, {}),
      readJsonSetting<SiteContacts>(this.prisma, CONTACTS_KEY, {}),
      readJsonSetting<Record<string, string>>(this.prisma, APP_TEXTS_KEY, {}),
      this.prisma.setting.findMany({ where: { key: { in: [...appKeys, 'ranking.auto_bump_enabled', 'ranking.bump_cooldown_days'] } } })
    ]);
    // Настройки окон приложения: { 'app.install.enabled': true, 'app.install.delay_sec': 8, … }
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    const app: Record<string, unknown> = { texts };
    for (const k of appKeys) {
      const def = MANAGED_SETTINGS[k];
      const raw = byKey.get(k) ?? def.default;
      app[k] = def.type === 'bool' ? raw === 'true' : Number(raw);
    }
    // Что доступно авторам: автоподнятие и через сколько дней оно срабатывает
    const features = {
      autoBump: (byKey.get('ranking.auto_bump_enabled') ?? 'true') === 'true',
      bumpCooldownDays: Number(byKey.get('ranking.bump_cooldown_days') ?? MANAGED_SETTINGS['ranking.bump_cooldown_days'].default)
    };
    return { neighbors, contacts, app, features };
  }

  @Get('regions')
  async regions() {
    return this.prisma.region.findMany({
      orderBy: { launched: 'desc' },
      include: { cities: true }
    });
  }

  @Get('cities')
  async cities() {
    return this.prisma.city.findMany({ orderBy: { name: 'asc' } });
  }
}
