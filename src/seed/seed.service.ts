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
      ['ranking.boost_bonus', '0.15', 'Бонус к score первые 24 ч после публикации и после подъёма'],
      ['ranking.bump_cooldown_days', '10', 'Через сколько дней после публикации или подъёма можно поднять снова'],
      ['ranking.archive_days', '30', 'Дней до отправки в архив'],

      // Модерация
      ['ads.rateLimit.perDay', '5', 'Объявлений в день на юзера'],
      ['ads.rateLimit.perHour', '1', 'Объявлений в час на юзера'],
      ['ads.autoApprove', 'false', 'Автоодобрение без ручной модерации'],
      ['moderation.llm.enabled', 'false', 'LLM-модерация через GigaChat'],
      ['moderation.llm.provider', 'gigachat', 'Провайдер LLM'],

      // Отзывы
      ['ads.lifetime_days', '60', 'Срок показа объявления, дней (потом — архив)'],
      ['ads.archive_keep_days', '90', 'Сколько дней хранить архив до удаления'],
      ['ads.rejected_keep_days', '30', 'Сколько дней хранить отклонённые до удаления'],
      ['ads.lifecycle_warn_days', '3', 'За сколько дней предупреждать об архиве и удалении'],
      ['reviews.min_messages', '4', 'Сообщений от каждой стороны, чтобы оставить отзыв'],
      ['reviews.min_hours', '1', 'Часов с первого сообщения, чтобы оставить отзыв'],

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
      // Значение не перезаписываем: его меняют в админке, и деплой не должен его сбрасывать.
      await this.prisma.setting.upsert({
        where: { key },
        update: { description },
        create: { key, value, description }
      });
    }
    this.logger.log(`✔ Settings: ${settings.length}`);
  }
}
