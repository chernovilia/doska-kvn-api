/**
 * Seed БД мок-данными.
 * Запуск:  npm run seed
 * Требует запущенного Postgres и настроенного DATABASE_URL.
 *
 * Идемпотентно: повторный запуск не создаёт дублей (используем upsert).
 */

import { PrismaClient, AdStatus } from '@prisma/client';

const prisma = new PrismaClient();

const REGIONS = [
  {
    id: 'kvn',
    name: 'КВН — Кулебаки, Выкса, Навашино',
    shortName: 'КВН',
    hint: 'Агломерация',
    domain: 'доска-квн.рф',
    launched: true,
    neighbors: ['murom', 'arzamas', 'pavlovo']
  },
  {
    id: 'murom',
    name: 'Муром',
    shortName: 'Муром',
    hint: 'Владимирская область',
    domain: 'доска-муром.рф',
    launched: false,
    neighbors: ['kvn']
  },
  {
    id: 'arzamas',
    name: 'Арзамас',
    shortName: 'Арзамас',
    hint: 'Нижегородская область',
    domain: 'доска-арзамас.рф',
    launched: false,
    neighbors: ['kvn', 'pavlovo']
  },
  {
    id: 'pavlovo',
    name: 'Павлово',
    shortName: 'Павлово',
    hint: 'Нижегородская область',
    domain: 'доска-павлово.рф',
    launched: false,
    neighbors: ['kvn', 'arzamas']
  },
  {
    id: 'sarov',
    name: 'Саров',
    shortName: 'Саров',
    hint: 'Нижегородская область',
    domain: 'доска-саров.рф',
    launched: false,
    neighbors: ['arzamas']
  }
];

const CITIES = [
  { id: 'kulebaki', name: 'Кулебаки', regionId: 'kvn', population: 32000 },
  { id: 'vyksa', name: 'Выкса', regionId: 'kvn', population: 53000 },
  { id: 'navashino', name: 'Навашино', regionId: 'kvn', population: 15000 },
  { id: 'murom', name: 'Муром', regionId: 'murom', population: 108000 },
  { id: 'arzamas', name: 'Арзамас', regionId: 'arzamas', population: 103000 },
  { id: 'pavlovo', name: 'Павлово', regionId: 'pavlovo', population: 55000 },
  { id: 'sarov', name: 'Саров', regionId: 'sarov', population: 95000 }
];

const NOW = new Date('2026-09-21T14:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

async function main() {
  console.log('→ Seeding regions and cities...');
  for (const r of REGIONS) {
    await prisma.region.upsert({
      where: { id: r.id },
      update: r,
      create: r
    });
  }
  for (const c of CITIES) {
    await prisma.city.upsert({
      where: { id: c.id },
      update: c,
      create: c
    });
  }

  console.log('→ Seeding demo user...');
  const demo = await prisma.user.upsert({
    where: { id: 'u-ilya' },
    update: {},
    create: {
      id: 'u-ilya',
      phone: '+79081234567',
      name: 'Илья Чернов',
      avatar:
        'https://images.unsplash.com/photo-1502685104226-ee32379fefbe?w=200&h=200&fit=crop&auto=format',
      homeCityId: 'vyksa',
      type: 'shop',
      role: 'owner',
      verified: true,
      rating: 4.9,
      reviewsCount: 34,
      dealsCount: 128
    }
  });

  console.log('→ Seeding demo ads...');
  const demoAds = [
    {
      id: 'm-macbook-vyksa',
      section: 'market',
      categoryGroup: 'Электроника',
      category: 'Ноутбуки',
      title: 'MacBook Pro 13" 2020, M1, 16/512',
      price: 78000,
      cityId: 'vyksa',
      regionId: 'kvn',
      address: 'Выкса, ул. Ленина',
      description:
        'Ноутбук в идеальном состоянии, циклов зарядки 87. Полный комплект: коробка, зарядка.',
      top: true,
      verified: true,
      avitoUrl: 'https://www.avito.ru/vyksa/noutbuki',
      photos: [
        'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=900&auto=format&fit=crop'
      ]
    },
    {
      id: 's-elec-kul',
      section: 'services',
      categoryGroup: 'Ремонт и обслуживание',
      category: 'Электрик',
      title: 'Электрик с выездом Кулебаки / Выкса',
      price: 500,
      priceSuffix: 'от, ₽',
      cityId: 'kulebaki',
      regionId: 'kvn',
      address: 'Кулебаки и район',
      description: 'Установка розеток, замена проводки, штробление. Опыт 14 лет.',
      top: true,
      verified: true,
      photos: [
        'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=900&auto=format&fit=crop'
      ]
    },
    {
      id: 'r-2k-vyksa',
      section: 'realty',
      categoryGroup: 'Аренда — жильё',
      category: 'Сдам 2-к квартиру',
      title: 'Сдам 2-к квартиру в центре Выксы',
      price: 18000,
      priceSuffix: '₽/мес',
      cityId: 'vyksa',
      regionId: 'kvn',
      address: 'Выкса, ул. Островского, 42',
      description: '52 м², 3/5 эт., кирпич. Мебель, техника, интернет.',
      top: true,
      verified: true,
      photos: [
        'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=900&auto=format&fit=crop'
      ]
    },
    {
      id: 'a-vesta-vyksa',
      section: 'auto',
      categoryGroup: 'Легковые',
      category: 'Седаны',
      title: 'Lada Vesta 2019, 1.6, МКПП',
      price: 720000,
      cityId: 'vyksa',
      regionId: 'kvn',
      address: 'Выкса, ул. Ленина',
      description: 'Один хозяин по ПТС, обслуживание у ОД. Пробег 68000 км.',
      top: true,
      verified: true,
      avitoUrl: 'https://www.avito.ru/vyksa/avtomobili',
      photos: [
        'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=900&auto=format&fit=crop'
      ]
    },
    {
      id: 'e-cinema-kul',
      section: 'events',
      categoryGroup: 'Развлечения',
      category: 'Кино',
      title: 'Киносеанс «Ёлки-11» в ДК Кулебаки',
      price: 250,
      priceSuffix: '₽/билет',
      cityId: 'kulebaki',
      regionId: 'kvn',
      address: 'Кулебаки, ДК Кулебаки, Большой зал',
      description: 'Премьера в маленьком городе. Попкорн и лимонад в фойе.',
      eventDate: new Date('2026-09-26T16:00:00Z'),
      top: true,
      verified: true,
      photos: [
        'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=900&auto=format&fit=crop'
      ]
    }
  ];

  for (const ad of demoAds) {
    const { photos, ...rest } = ad;
    const createdAt = daysAgo(Math.floor(Math.random() * 5) + 1);
    await prisma.ad.upsert({
      where: { id: ad.id },
      update: {
        ...rest,
        status: AdStatus.approved,
        publishedAt: createdAt
      },
      create: {
        ...rest,
        authorId: demo.id,
        status: AdStatus.approved,
        moderationLevel: 'auto',
        createdAt,
        publishedAt: createdAt
      }
    });

    // Обнуляем и добавляем фото заново
    await prisma.adPhoto.deleteMany({ where: { adId: ad.id } });
    for (let i = 0; i < photos.length; i++) {
      await prisma.adPhoto.create({
        data: { adId: ad.id, url: photos[i], order: i }
      });
    }
  }

  console.log('→ Seeding settings (feature flags)...');
  const settings = [
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
    await prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value }
    });
  }

  console.log('✔ Seed complete');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
