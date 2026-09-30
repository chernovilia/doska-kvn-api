import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CONTACTS_KEY, NEIGHBORS_KEY, SiteContacts, readJsonSetting } from '../settings/json-settings';

@Controller()
export class RegionsController {
  constructor(private readonly prisma: PrismaService) {}

  // Публичные настройки сайта из админки: соседние города для блока «В соседних городах»
  // и контакты для подвала. Без секретов — отдаётся всем.
  @Get('site')
  async site() {
    const [neighbors, contacts] = await Promise.all([
      readJsonSetting<Record<string, string[]>>(this.prisma, NEIGHBORS_KEY, {}),
      readJsonSetting<SiteContacts>(this.prisma, CONTACTS_KEY, {})
    ]);
    return { neighbors, contacts };
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
