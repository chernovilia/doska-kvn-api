import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdStatus } from '@prisma/client';

/**
 * Одноразовый seed при старте приложения.
 * Активируется env-переменной SEED_ON_STARTUP=true.
 * Идемпотентен: работает через upsert, повторные запуски безопасны.
 *
 * Используем как обход отсутствия npm в Amvera Online IDE.
 * После первого запуска рекомендуется убрать env-переменную,
 * чтобы seed не молотил впустую при каждой пересборке.
 */
@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    if (process.env.SEED_ON_STARTUP !== 'true') return;
    try {
      await this.run();
    } catch (err) {
      this.logger.error('Seed failed', err as Error);
    }
  }

  async run() {
    this.logger.log('SEED_ON_STARTUP=true → running seed...');

    const REGIONS = [
      { id: 'kvn', name: 'КВН — Кулебаки, Выкса, Навашино', shortName: 'КВН', hint: 'Агломерация', domain: 'доска-квн.рф', launched: true, neighbors: ['murom', 'arzamas', 'pavlovo'] },
      { id: 'murom', name: 'Муром', shortName: 'Муром', hint: 'Владимирская область', domain: 'доска-муром.рф', launched: false, neighbors: ['kvn'] },
      { id: 'arzamas', name: 'Арзамас', shortName: 'Арзамас', hint: 'Нижегородская область', domain: 'доска-арзамас.рф', launched: false, neighbors: ['kvn', 'pavlovo'] },
      { id: 'pavlovo', name: 'Павлово', shortName: 'Павлово', hint: 'Нижегородская область', domain: 'доска-павлово.рф', launched: false, neighbors: ['kvn', 'arzamas'] },
      { id: 'sarov', name: 'Саров', shortName: 'Саров', hint: 'Нижегородская область', domain: 'доска-саров.рф', launched: false, neighbors: ['arzamas'] }
    ];
    for (const r of REGIONS) {
      await this.prisma.region.upsert({ where: { id: r.id }, update: r, create: r });
    }
    this.logger.log(`✔ Regions: ${REGIONS.length}`);

    const CITIES = [
      { id: 'kulebaki', name: 'Кулебаки', regionId: 'kvn', population: 32000 },
      { id: 'vyksa', name: 'Выкса', regionId: 'kvn', population: 53000 },
      { id: 'navashino', name: 'Навашино', regionId: 'kvn', population: 15000 },
      { id: 'murom', name: 'Муром', regionId: 'murom', population: 108000 },
      { id: 'arzamas', name: 'Арзамас', regionId: 'arzamas', population: 103000 },
      { id: 'pavlovo', name: 'Павлово', regionId: 'pavlovo', population: 55000 },
      { id: 'sarov', name: 'Саров', regionId: 'sarov', population: 95000 }
    ];
    for (const c of CITIES) {
      await this.prisma.city.upsert({ where: { id: c.id }, update: c, create: c });
    }
    this.logger.log(`✔ Cities: ${CITIES.length}`);

    const demo = await this.prisma.user.upsert({
      where: { id: 'u-ilya' },
      update: {},
      create: {
        id: 'u-ilya',
        phone: '+79081234567',
        name: 'Илья Чернов',
        avatar: 'https://images.unsplash.com/photo-1502685104226-ee32379fefbe?w=200&h=200&fit=crop&auto=format',
        homeCityId: 'vyksa',
        type: 'shop',
        role: 'owner',
        verified: true,
        rating: 4.9,
        reviewsCount: 34,
        dealsCount: 128
      }
    });
    this.logger.log(`✔ Demo user: ${demo.id}`);

    const now = new Date('2026-09-21T14:00:00Z');
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

    const demoAds = [
      { id: 'm-macbook-vyksa', section: 'market', categoryGroup: 'Электроника', category: 'Ноутбуки', title: 'MacBook Pro 13" 2020, M1, 16/512', price: 78000, cityId: 'vyksa', regionId: 'kvn', address: 'Выкса, ул. Ленина', description: 'Ноутбук в идеальном состоянии, циклов зарядки 87.', top: true, verified: true, photos: ['https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=900&auto=format&fit=crop'] },
      { id: 's-elec-kul', section: 'services', categoryGroup: 'Ремонт и обслуживание', category: 'Электрик', title: 'Электрик с выездом Кулебаки / Выкса', price: 500, priceSuffix: 'от, ₽', cityId: 'kulebaki', regionId: 'kvn', address: 'Кулебаки и район', description: 'Установка розеток, замена проводки. Опыт 14 лет.', top: true, verified: true, photos: ['https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=900&auto=format&fit=crop'] },
      { id: 'r-2k-vyksa', section: 'realty', categoryGroup: 'Аренда — жильё', category: 'Сдам 2-к квартиру', title: 'Сдам 2-к квартиру в центре Выксы', price: 18000, priceSuffix: '₽/мес', cityId: 'vyksa', regionId: 'kvn', address: 'Выкса, ул. Островского, 42', description: '52 м², 3/5 эт., кирпич. Мебель, техника, интернет.', top: true, verified: true, photos: ['https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=900&auto=format&fit=crop'] },
      { id: 'a-vesta-vyksa', section: 'auto', categoryGroup: 'Легковые', category: 'Седаны', title: 'Lada Vesta 2019, 1.6, МКПП', price: 720000, cityId: 'vyksa', regionId: 'kvn', address: 'Выкса, ул. Ленина', description: 'Один хозяин по ПТС. Пробег 68000 км.', top: true, verified: true, photos: ['https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=900&auto=format&fit=crop'] },
      { id: 'e-cinema-kul', section: 'events', categoryGroup: 'Развлечения', category: 'Кино', title: 'Киносеанс «Ёлки-11» в ДК Кулебаки', price: 250, priceSuffix: '₽/билет', cityId: 'kulebaki', regionId: 'kvn', address: 'Кулебаки, ДК Кулебаки, Большой зал', description: 'Премьера в маленьком городе.', eventDate: new Date('2026-09-26T16:00:00Z'), top: true, verified: true, photos: ['https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=900&auto=format&fit=crop'] }
    ];

    for (const ad of demoAds) {
      const { photos, ...rest } = ad;
      const createdAt = daysAgo(Math.floor(Math.random() * 5) + 1);
      await this.prisma.ad.upsert({
        where: { id: ad.id },
        update: { ...rest, status: AdStatus.approved, publishedAt: createdAt },
        create: {
          ...rest,
          authorId: demo.id,
          status: AdStatus.approved,
          moderationLevel: 'auto',
          createdAt,
          publishedAt: createdAt
        }
      });
      await this.prisma.adPhoto.deleteMany({ where: { adId: ad.id } });
      for (let i = 0; i < photos.length; i++) {
        await this.prisma.adPhoto.create({
          data: { adId: ad.id, url: photos[i], order: i }
        });
      }
    }
    this.logger.log(`✔ Ads: ${demoAds.length}`);

    const settings: [string, string][] = [
      ['ads.rateLimit.perDay', '5'],
      ['ads.rateLimit.perHour', '1'],
      ['ads.autoApprove', 'false'],
      ['moderation.llm.enabled', 'false'],
      ['moderation.llm.provider', 'gigachat'],
      ['messages.rateLimit.perMinute', '30'],
      ['auth.sms.enabled', 'true'],
      ['auth.email.enabled', 'true'],
      ['auth.yandex.enabled', 'false'],
      ['payments.enabled', 'false'],
      ['signup.opened', 'true']
    ];
    for (const [key, value] of settings) {
      await this.prisma.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value }
      });
    }
    this.logger.log(`✔ Settings: ${settings.length}`);

    this.logger.log('🌱 Seed complete — можешь убрать SEED_ON_STARTUP из переменных');
  }
}
