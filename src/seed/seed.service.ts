import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdStatus, UserType, TierName } from '@prisma/client';

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

    await this.seedRegions();
    await this.seedCities();
    await this.seedTiers();
    const demo = await this.seedDemoUser();
    await this.seedDemoBusinessProfile(demo.id);
    await this.seedDemoAds(demo.id);
    await this.seedSettings();

    this.logger.log('🌱 Seed complete — можешь убрать SEED_ON_STARTUP из переменных');
  }

  private async seedRegions() {
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
  }

  private async seedCities() {
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
  }

  private async seedTiers() {
    const TIERS = [
      {
        name: TierName.start,
        displayName: 'Старт',
        priceMonthly: 0,
        priceYearly: 0,
        maxActiveAds: 15,
        autoPromoLevel: 0,
        hasAnalytics: false,
        hasTopBadge: false,
        hasPartnerBadge: false,
        showAllRegionCities: false,
        hasPrioritySupport: false,
        availableForTypes: [UserType.master, UserType.shop],
        displayOrder: 1
      },
      {
        name: TierName.top,
        displayName: 'ТОП',
        priceMonthly: 50000,       // 500 ₽
        priceYearly: 480000,       // 4 800 ₽ (12 мес × 500 − 20%)
        maxActiveAds: 50,
        autoPromoLevel: 1,
        hasAnalytics: true,
        hasTopBadge: true,
        hasPartnerBadge: false,
        showAllRegionCities: false,
        hasPrioritySupport: false,
        availableForTypes: [UserType.master, UserType.shop],
        displayOrder: 2
      },
      {
        name: TierName.premium,
        displayName: 'Премиум',
        priceMonthly: 120000,      // 1 200 ₽
        priceYearly: 1152000,      // 11 520 ₽
        maxActiveAds: 100,
        autoPromoLevel: 2,
        hasAnalytics: true,
        hasTopBadge: true,
        hasPartnerBadge: true,
        showAllRegionCities: true,
        hasPrioritySupport: true,
        availableForTypes: [UserType.master, UserType.shop],
        displayOrder: 3
      }
    ];
    for (const t of TIERS) {
      await this.prisma.tier.upsert({
        where: { name: t.name },
        update: t,
        create: t
      });
    }
    this.logger.log(`✔ Tiers: ${TIERS.length}`);
  }

  private async seedDemoUser() {
    const user = await this.prisma.user.upsert({
      where: { id: 'u-ilya' },
      update: {},
      create: {
        id: 'u-ilya',
        phone: '+79081234567',
        name: 'Илья Чернов',
        avatar: 'https://images.unsplash.com/photo-1502685104226-ee32379fefbe?w=200&h=200&fit=crop&auto=format',
        homeCityId: 'vyksa',
        type: UserType.master,
        role: 'owner',
        verified: true,
        isPublic: true,
        rating: 4.9,
        reviewsCount: 34,
        dealsCount: 128
      }
    });
    // Кошелёк со стартовой наградой
    await this.prisma.wallet.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, balance: 10 }
    });
    this.logger.log(`✔ Demo user: ${user.id}`);
    return user;
  }

  private async seedDemoBusinessProfile(userId: string) {
    await this.prisma.businessProfile.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        slug: 'ilya-master',
        name: 'Мастерская Ильи',
        description: 'Ремонт стиральных машин, электрика и мелкий ремонт бытовой техники. Выезд по КВН.',
        categories: ['Ремонт техники', 'Электрик', 'Сантехник'],
        hours: 'Пн–Сб · 8:00–22:00',
        address: 'Выкса, ул. Ленина, 14',
        phone: '+7 (908) 123-45-67',
        verified: true,
        currentTierName: 'top' // задел: юзер условно на ТОП-подписке
      }
    });
    this.logger.log(`✔ Business profile: ilya-master`);
  }

  private async seedDemoAds(userId: string) {
    const now = new Date('2026-09-22T14:00:00Z');
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

    const demoAds = [
      { id: 'm-macbook-vyksa', section: 'market', categoryGroup: 'Электроника', category: 'Ноутбуки', title: 'MacBook Pro 13" 2020, M1, 16/512', price: 78000, cityId: 'vyksa', regionId: 'kvn', address: 'Выкса, ул. Ленина', description: 'Ноутбук в идеальном состоянии, циклов зарядки 87.', top: true, verified: true, promoLevel: 4, photos: ['https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=900&auto=format&fit=crop'] },
      { id: 's-elec-kul', section: 'services', categoryGroup: 'Ремонт и обслуживание', category: 'Электрик', title: 'Электрик с выездом Кулебаки / Выкса', price: 500, priceSuffix: 'от, ₽', cityId: 'kulebaki', regionId: 'kvn', address: 'Кулебаки и район', description: 'Установка розеток, замена проводки. Опыт 14 лет.', top: true, verified: true, promoLevel: 1, photos: ['https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=900&auto=format&fit=crop'] },
      { id: 'r-2k-vyksa', section: 'realty', categoryGroup: 'Аренда — жильё', category: 'Сдам 2-к квартиру', title: 'Сдам 2-к квартиру в центре Выксы', price: 18000, priceSuffix: '₽/мес', cityId: 'vyksa', regionId: 'kvn', address: 'Выкса, ул. Островского, 42', description: '52 м², 3/5 эт., кирпич. Мебель, техника, интернет.', top: true, verified: true, promoLevel: 0, photos: ['https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=900&auto=format&fit=crop'] },
      { id: 'a-vesta-vyksa', section: 'auto', categoryGroup: 'Легковые', category: 'Седаны', title: 'Lada Vesta 2019, 1.6, МКПП', price: 720000, cityId: 'vyksa', regionId: 'kvn', address: 'Выкса, ул. Ленина', description: 'Один хозяин по ПТС. Пробег 68000 км.', top: true, verified: true, promoLevel: 2, urgent: true, photos: ['https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=900&auto=format&fit=crop'] },
      { id: 'e-cinema-kul', section: 'events', categoryGroup: 'Развлечения', category: 'Кино', title: 'Киносеанс «Ёлки-11» в ДК Кулебаки', price: 250, priceSuffix: '₽/билет', cityId: 'kulebaki', regionId: 'kvn', address: 'Кулебаки, ДК Кулебаки, Большой зал', description: 'Премьера в маленьком городе.', eventDate: new Date('2026-09-26T16:00:00Z'), top: true, verified: true, promoLevel: 0, photos: ['https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=900&auto=format&fit=crop'] }
    ];

    for (const ad of demoAds) {
      const { photos, ...rest } = ad;
      const createdAt = daysAgo(Math.floor(Math.random() * 5) + 1);
      await this.prisma.ad.upsert({
        where: { id: ad.id },
        update: { ...rest, status: AdStatus.approved, publishedAt: createdAt },
        create: {
          ...rest,
          authorId: userId,
          authorType: UserType.master,
          authorSnapshot: {
            name: 'Илья Чернов',
            avatar: 'https://images.unsplash.com/photo-1502685104226-ee32379fefbe?w=200&h=200&fit=crop&auto=format',
            rating: 4.9,
            verified: true,
            type: 'master'
          },
          status: AdStatus.approved,
          moderationLevel: 'auto',
          createdAt,
          publishedAt: createdAt,
          viewsCount: Math.floor(Math.random() * 200),
          writeClicksCount: Math.floor(Math.random() * 20)
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
  }

  private async seedSettings() {
    const settings: [string, string, string][] = [
      // Общий выключатель монетизации
      ['payments.enabled', 'false', 'Включает всю монетизацию в UI'],
      ['payments.ad_promos', 'false', 'Показывать кнопки Поднять/Срочно/VIP'],
      ['payments.subscriptions', 'false', 'Показывать тарифы Мастер/Магазин'],
      ['payments.banners', 'false', 'Активировать баннерную сеть'],
      ['payments.wallet.stars_enabled', 'false', 'Кошелёк звёзд'],

      // Цены разовых опций (в копейках)
      ['payments.ad_promo.bump.price', '3900', 'Поднять — 39 ₽'],
      ['payments.ad_promo.urgent.price', '7900', 'Срочно — 79 ₽'],
      ['payments.ad_promo.vip.price', '19900', 'VIP — 199 ₽'],
      ['payments.ad_promo.highlight.price', '2900', 'Выделить цветом — 29 ₽'],
      ['payments.ad_promo.auto_bump.price', '24900', 'Автоподъём 30 дней — 249 ₽'],
      ['payments.ad_promo.hide_phone.price', '4900', 'Скрыть телефон — 49 ₽'],

      // Правила подписок
      ['payments.free_trial_days', '7', 'Trial ТОП-подписки для новых'],
      ['payments.yearly_discount', '0.20', 'Скидка при годовой оплате'],
      ['payments.grace_period_days', '3', 'Дней после истечения подписки'],

      // Верификация
      ['payments.verification.legal.price', '30000', 'Юр. проверка ИП/ООО — 300 ₽'],

      // Звёзды (курс обмена)
      ['payments.wallet.stars_rate.bump', '50', 'Стоимость Поднять в звёздах'],
      ['payments.wallet.stars_rate.urgent', '100', 'Стоимость Срочно в звёздах'],
      ['payments.wallet.stars_rate.vip', '200', 'Стоимость VIP в звёздах'],

      // Награды
      ['rewards.first_ad_stars', '10', '⭐ за первое объявление'],
      ['rewards.first_deal_stars', '5', '⭐ за первую сделку'],
      ['rewards.review_stars', '3', '⭐ за отзыв'],
      ['rewards.first_purchase_stars', '20', '⭐ за первую покупку тарифа'],

      // Ранкинг — веса
      ['ranking.weight.freshness', '0.35', 'Вес свежести'],
      ['ranking.weight.promo', '0.30', 'Вес платного продвижения'],
      ['ranking.weight.trust', '0.15', 'Вес доверия автору'],
      ['ranking.weight.quality', '0.10', 'Вес качества объявления'],
      ['ranking.weight.engagement', '0.10', 'Вес вовлечённости'],
      ['ranking.freshness_days', '10', 'За сколько дней свежесть падает до 0'],
      ['ranking.vip_top_positions', '3', 'Позиций сверху зарезервировано под VIP'],
      ['ranking.same_author_max_top10', '3', 'Максимум объявлений одного автора в топ-10'],
      ['ranking.boost_bonus', '0.15', 'Бонус к score после Поднятия (24ч)'],
      ['ranking.archive_days', '30', 'Дней до отправки в архив'],

      // Модерация
      ['ads.rateLimit.perDay', '5', 'Объявлений в день на юзера'],
      ['ads.rateLimit.perHour', '1', 'Объявлений в час на юзера'],
      ['ads.autoApprove', 'false', 'Автоодобрение без ручной модерации'],
      ['moderation.llm.enabled', 'false', 'LLM-модерация через GigaChat'],
      ['moderation.llm.provider', 'gigachat', 'Провайдер LLM'],

      // Мессенджер
      ['messages.rateLimit.perMinute', '30', 'Сообщений в минуту'],

      // Авторизация
      ['auth.sms.enabled', 'true', 'SMS-авторизация'],
      ['auth.email.enabled', 'true', 'E-mail magic-link'],
      ['auth.yandex.enabled', 'false', 'Яндекс ID'],

      // Регистрация
      ['signup.opened', 'true', 'Открыта ли регистрация']
    ];
    for (const [key, value, description] of settings) {
      await this.prisma.setting.upsert({
        where: { key },
        update: { value, description },
        create: { key, value, description }
      });
    }
    this.logger.log(`✔ Settings: ${settings.length}`);
  }
}
