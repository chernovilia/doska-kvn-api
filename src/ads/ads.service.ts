import { Injectable, Logger, NotFoundException, BadRequestException, OnApplicationBootstrap } from '@nestjs/common';
import { assertNotBlocked } from '../auth/blocked';
import { adminUserIds, isAdminUser } from '../auth/admin-check';
import { NotificationsService } from '../notifications/notifications.service';
import { buildSearchText, normalizeSearch } from './search-text';
import { publicAd } from './public-ad';
import { newAdId, resolveAdId } from './short-id';
import { DAY_MS, lifecycleInfo, lifecycleSettings, purgeAd } from './lifecycle';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { S3ClientService } from '../uploads/s3.client';
import { ListAdsDto } from './dto/list-ads.dto';
import { CreateAdDto } from './dto/create-ad.dto';
import { FREE_FROM_SECTIONS, FREE_SECTION } from './sections';
import { AdStatus, Prisma, UserType } from '@prisma/client';

async function whereForPlace(prisma: PrismaService, place?: string) {
  if (!place) return {};
  const region = await prisma.region.findUnique({ where: { id: place } });
  if (region) return { regionId: region.id };
  const city = await prisma.city.findUnique({ where: { id: place } });
  if (city) return { cityId: city.id };
  // Неизвестное место (регион ещё не заведён в БД) — пусто, а не вся доска:
  // иначе блок «в соседних городах» показывал объявления самого города.
  return { id: { in: [] } };
}

// Характеристики: плоский объект «ключ → строка или число». Набор полей задаёт фронт
// (data/attributes.js), сервер только не пускает мусор: до 20 полей, короткие значения.
function sanitizeAttributes(input?: Record<string, unknown>) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const out: Record<string, string | number> = {};
  for (const [key, raw] of Object.entries(input)) {
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(key)) throw new BadRequestException(`Bad attribute: ${key}`);
    if (raw == null || raw === '') continue;
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw) || Math.abs(raw) > 1e9) throw new BadRequestException(`Bad value: ${key}`);
      out[key] = raw;
    } else if (typeof raw === 'string') {
      const v = raw.trim();
      if (v.length > 100) throw new BadRequestException(`Too long: ${key}`);
      if (v) out[key] = v;
    } else {
      throw new BadRequestException(`Bad value: ${key}`);
    }
  }
  const keys = Object.keys(out);
  if (keys.length > 20) throw new BadRequestException('Too many attributes');
  return keys.length ? out : undefined;
}

// Фильтр ленты по характеристикам: значение — точное совпадение (варианты из списка),
// { gte, lte } — диапазон для чисел. Мусор — 400, а не молча пустая лента.
function attributeFilters(raw?: string): Prisma.AdWhereInput[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestException('attr: invalid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BadRequestException('attr: object expected');
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length > 10) throw new BadRequestException('attr: too many filters');
  const out: Prisma.AdWhereInput[] = [];
  for (const [key, value] of entries) {
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(key)) throw new BadRequestException(`attr: bad key ${key}`);
    if (typeof value === 'string' || typeof value === 'number') {
      if (typeof value === 'string' && value.length > 100) throw new BadRequestException(`attr: too long ${key}`);
      out.push({ attributes: { path: [key], equals: value } });
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const { gte, lte } = value as { gte?: unknown; lte?: unknown };
      const num = (n: unknown) => {
        if (typeof n !== 'number' || !Number.isFinite(n)) throw new BadRequestException(`attr: bad range ${key}`);
        return n;
      };
      if (gte != null) out.push({ attributes: { path: [key], gte: num(gte) } });
      if (lte != null) out.push({ attributes: { path: [key], lte: num(lte) } });
      continue;
    }
    throw new BadRequestException(`attr: bad value ${key}`);
  }
  return out;
}

// Ранкинг: см. BUSINESS-MODEL.md → «Алгоритм ранкинга».
// Веса читаются из таблицы Setting и кешируются на 1 минуту.
interface RankingWeights {
  freshness: number;
  promo: number;
  trust: number;
  quality: number;
  engagement: number;
  freshnessDays: number;
  vipTopPositions: number;
  sameAuthorMaxTop10: number;
  boostBonus: number;
  bumpCooldownDays: number;
}

@Injectable()
export class AdsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdsService.name);

  private weightsCache: { data: RankingWeights; expires: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3ClientService,
    private readonly notifications: NotificationsService
  ) {}

  private async getWeights(): Promise<RankingWeights> {
    if (this.weightsCache && this.weightsCache.expires > Date.now()) {
      return this.weightsCache.data;
    }
    const rows = await this.prisma.setting.findMany({
      where: { key: { startsWith: 'ranking.' } }
    });
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;
    const w: RankingWeights = {
      freshness: parseFloat(map['ranking.weight.freshness'] ?? '0.35'),
      promo: parseFloat(map['ranking.weight.promo'] ?? '0.30'),
      trust: parseFloat(map['ranking.weight.trust'] ?? '0.15'),
      quality: parseFloat(map['ranking.weight.quality'] ?? '0.10'),
      engagement: parseFloat(map['ranking.weight.engagement'] ?? '0.10'),
      freshnessDays: parseInt(map['ranking.freshness_days'] ?? '10', 10),
      vipTopPositions: parseInt(map['ranking.vip_top_positions'] ?? '3', 10),
      sameAuthorMaxTop10: parseInt(map['ranking.same_author_max_top10'] ?? '3', 10),
      boostBonus: parseFloat(map['ranking.boost_bonus'] ?? '0.15'),
      bumpCooldownDays: parseFloat(map['ranking.bump_cooldown_days'] ?? '10')
    };
    this.weightsCache = { data: w, expires: Date.now() + 60_000 };
    return w;
  }

  // Объявлениям без searchText (созданы до поля) строим его при старте — их немного,
  // а новые получают поле сразу при создании.
  async onApplicationBootstrap() {
    const rows = await this.prisma.ad.findMany({
      where: { searchText: null },
      select: { id: true, title: true, description: true, address: true, categoryGroup: true, category: true, attributes: true },
      take: 5000
    });
    for (const ad of rows) {
      await this.prisma.ad.update({ where: { id: ad.id }, data: { searchText: buildSearchText(ad) } });
    }
    if (rows.length) this.logger.log(`searchText заполнен у ${rows.length} объявлений`);

    // Опубликованным до появления publishedAt — дата создания, иначе они выпали бы из свежести.
    const { count } = await this.prisma.$executeRaw`
      UPDATE "Ad" SET "publishedAt" = "createdAt" WHERE status = 'approved' AND "publishedAt" IS NULL`.then((n) => ({ count: n }));
    if (count) this.logger.log(`publishedAt заполнен у ${count} объявлений`);
  }

  // Поднять можно через bumpCooldownDays после публикации или прошлого подъёма.
  private nextBumpAt(
    ad: { status?: string; publishedAt?: Date | null; createdAt: Date; boostedAt: Date | null },
    w: RankingWeights
  ): Date | null {
    if (ad.status && ad.status !== AdStatus.approved) return null;
    const from = Math.max(
      new Date(ad.publishedAt ?? ad.createdAt).getTime(),
      ad.boostedAt ? new Date(ad.boostedAt).getTime() : 0
    );
    return new Date(from + w.bumpCooldownDays * 24 * 3_600_000);
  }

  // Бесплатный подъём: boostedAt = now → +boostBonus в computeScore на 24 часа.
  async bump(userId: string, adId: string) {
    const ad = await this.prisma.ad.findUnique({
      where: { id: adId },
      select: { authorId: true, status: true, boostedAt: true, publishedAt: true, createdAt: true }
    });
    if (!ad) throw new NotFoundException('Ad not found');
    if (ad.authorId !== userId) throw new BadRequestException('Not your ad');
    if (ad.status !== AdStatus.approved) {
      throw new BadRequestException('Поднять можно только опубликованное объявление');
    }
    const w = await this.getWeights();
    const next = this.nextBumpAt(ad, w);
    if (next && next.getTime() > Date.now()) {
      throw new BadRequestException({
        message: 'Поднять пока нельзя',
        nextBumpAt: next
      });
    }
    const updated = await this.prisma.ad.update({
      where: { id: adId },
      data: { boostedAt: new Date() },
      select: { boostedAt: true, publishedAt: true, createdAt: true, status: true }
    });
    return {
      boostedAt: updated.boostedAt,
      nextBumpAt: this.nextBumpAt(updated, w)
    };
  }

  private computeScore(ad: any, w: RankingWeights): number {
    const now = Date.now();
    // Свежесть — от публикации: объявление, которое ждало модерацию, не должно «стареть» в очереди.
    const published = new Date(ad.publishedAt ?? ad.createdAt).getTime();
    const hours = (now - published) / 3_600_000;
    const freshness = Math.max(0, 1 - hours / (24 * w.freshnessDays));

    const promo = (ad.promoLevel || 0) / 4;

    const rating = ad.author?.rating ?? 0;
    const trust = (ad.author?.verified ? 0.5 : 0) + rating / 10;

    const hasPhotos = (ad.photos?.length ?? 0) > 0;
    const hasDescription = (ad.description || '').length > 50;
    const quality = (hasPhotos ? 0.5 : 0) + (hasDescription ? 0.5 : 0);

    const views = ad.viewsCount || 0;
    const writes = ad.writeClicksCount || 0;
    const engagement =
      Math.min(1, views / 100) * 0.5 + Math.min(1, writes / 10) * 0.5;

    let score =
      freshness * w.freshness +
      promo * w.promo +
      trust * w.trust +
      quality * w.quality +
      engagement * w.engagement;

    // Первые 24 часа после публикации или подъёма — бонус: новое объявление сразу наверху.
    const lift = Math.max(published, ad.boostedAt ? new Date(ad.boostedAt).getTime() : 0);
    if ((now - lift) / 3_600_000 < 24) score += w.boostBonus;
    return score;
  }

  // Применяет правила поверх формулы:
  // 1. VIP (promoLevel=4) — первые N позиций.
  // 2. Anti-repetition: не даём одному автору более M карточек в топ-10.
  private applyRules(sorted: any[], w: RankingWeights): any[] {
    // Отделяем VIP от остальных.
    const vip = sorted.filter((a) => a.promoLevel === 4).slice(0, w.vipTopPositions);
    const rest = sorted.filter((a) => !vip.includes(a));

    // Anti-repetition в топ-10
    const authorCount = new Map<string, number>();
    const top: any[] = [];
    const tail: any[] = [];
    for (const ad of rest) {
      if (top.length < 10) {
        const cnt = authorCount.get(ad.authorId) ?? 0;
        if (cnt >= w.sameAuthorMaxTop10) {
          tail.push(ad);
        } else {
          top.push(ad);
          authorCount.set(ad.authorId, cnt + 1);
        }
      } else {
        tail.push(ad);
      }
    }
    return [...vip, ...top, ...tail];
  }

  async list(q: ListAdsDto) {
    const placeWhere = await whereForPlace(this.prisma, q.place);

    // Условия через AND: раньше chip и search оба писали в один ключ OR, и chip терялся.
    const and: Prisma.AdWhereInput[] = [];
    if (q.group) and.push({ categoryGroup: q.group });
    if (q.authorId) and.push({ authorId: q.authorId });
    and.push(...attributeFilters(q.attr));
    if (q.chip) {
      and.push({
        OR: [
          { category: { contains: q.chip, mode: 'insensitive' } },
          { title: { contains: q.chip, mode: 'insensitive' } }
        ]
      });
    }
    if (q.search?.trim()) {
      and.push({ searchText: { contains: normalizeSearch(q.search) } });
    }
    if (q.priceMin != null || q.priceMax != null) {
      and.push({
        price: {
          ...(q.priceMin != null ? { gte: q.priceMin } : {}),
          ...(q.priceMax != null ? { lte: q.priceMax } : {})
        }
      });
    }

    const sectionWhere: Prisma.AdWhereInput =
      q.section === FREE_SECTION
        ? { price: 0, section: { in: FREE_FROM_SECTIONS } }
        : q.section
        ? { section: q.section }
        : {};

    const where: Prisma.AdWhereInput = {
      status: AdStatus.approved,
      author: { blockedAt: null }, // объявления заблокированных не показываем
      ...placeWhere,
      ...sectionWhere,
      ...(and.length ? { AND: and } : {})
    };

    const include = {
      author: {
        select: {
          id: true,
          name: true,
          avatar: true,
          rating: true,
          dealsCount: true,
          type: true,
          verified: true
        }
      },
      photos: { orderBy: { order: 'asc' as const } }
    };

    // По цене сортирует сама БД: ранкинг и VIP здесь не применяются.
    if (q.sort === 'cheap' || q.sort === 'expensive') {
      const [items, total] = await Promise.all([
        this.prisma.ad.findMany({
          where,
          orderBy: [{ price: q.sort === 'cheap' ? 'asc' : 'desc' }, { createdAt: 'desc' }],
          skip: q.offset ?? 0,
          take: q.limit ?? 100,
          include
        }),
        this.prisma.ad.count({ where })
      ]);
      return { items: items.map(publicAd), total };
    }

    // Тянем чуть с запасом: score-сортировка + правила потом обрежут.
    const takeRaw = Math.min(300, (q.limit ?? 100) + 100);

    const [rawItems, total] = await Promise.all([
      this.prisma.ad.findMany({
        where,
        orderBy: [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }], // предварительная сортировка
        take: takeRaw,
        include
      }),
      this.prisma.ad.count({ where })
    ]);

    // Ранкинг: либо recent (по дате), либо top (по score).
    let sorted;
    if (q.sort === 'recent') {
      sorted = rawItems; // уже отсортированы по дате публикации
    } else {
      const w = await this.getWeights();
      const withScore = rawItems.map((a) => ({ ...a, _score: this.computeScore(a, w) }));
      withScore.sort((a, b) => b._score - a._score);
      sorted = this.applyRules(withScore, w);
    }

    const items = sorted.slice(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? 100));
    return { items: items.map(publicAd), total };
  }

  // Телефон — только по отдельному запросу авторизованного юзера, чтобы его нельзя было
  // собрать скриптом из публичной карточки. Отдаём, только если продавец выбрал связь по телефону.
  async contact(adId: string) {
    const ad = await this.prisma.ad.findUnique({
      where: { id: adId },
      select: {
        phone: true,
        status: true,
        author: { select: { phone: true, contactMethod: true, blockedAt: true } }
      }
    });
    // Телефон — только у объявления, которое видно всем.
    if (!ad || ad.status !== AdStatus.approved || ad.author.blockedAt) throw new NotFoundException('Ad not found');
    const phone = ad.author.contactMethod === 'phone' ? ad.phone || ad.author.phone : null;
    if (!phone) throw new NotFoundException('Продавец принимает только сообщения');
    return { phone };
  }

  // Юзер удаляет своё объявление. Проверяем что автор совпадает — иначе 403.
  async removeOwn(userId: string, adId: string) {
    const ad = await this.prisma.ad.findUnique({ where: { id: adId }, select: { authorId: true } });
    if (!ad) throw new BadRequestException('Ad not found');
    if (ad.authorId !== userId) throw new BadRequestException('Not your ad');
    await purgeAd(this.prisma, this.s3, adId);
    return { ok: true };
  }

  // «Продано / неактуально»: автор сам убирает опубликованное в архив, вернуть можно в любой момент.
  async archiveOwn(userId: string, adId: string) {
    const ad = await this.prisma.ad.findUnique({ where: { id: adId }, select: { authorId: true, status: true } });
    if (!ad) throw new NotFoundException('Ad not found');
    if (ad.authorId !== userId) throw new BadRequestException('Not your ad');
    if (ad.status !== AdStatus.approved) {
      throw new BadRequestException('В архив можно убрать только опубликованное объявление');
    }
    const updated = await this.prisma.ad.update({
      where: { id: adId },
      data: { status: AdStatus.archived, archivedAt: new Date(), lifecycleWarnedAt: null }
    });
    const cfg = await lifecycleSettings(this.prisma);
    return { status: updated.status, archivedAt: updated.archivedAt, ...lifecycleInfo(updated, cfg) };
  }

  // Продлить: опубликованное — ещё на срок жизни, из архива — снова в ленту на срок жизни.
  // Скрытые модератором и отклонённые так не вернуть.
  async renewOwn(userId: string, adId: string) {
    const ad = await this.prisma.ad.findUnique({ where: { id: adId }, select: { authorId: true, status: true } });
    if (!ad) throw new NotFoundException('Ad not found');
    if (ad.authorId !== userId) throw new BadRequestException('Not your ad');
    if (ad.status !== AdStatus.approved && ad.status !== AdStatus.archived) {
      throw new BadRequestException('Продлить можно опубликованное объявление или объявление из архива');
    }
    const cfg = await lifecycleSettings(this.prisma);
    const updated = await this.prisma.ad.update({
      where: { id: adId },
      data: {
        status: AdStatus.approved,
        expiresAt: new Date(Date.now() + cfg.lifetimeDays * DAY_MS),
        archivedAt: null,
        lifecycleWarnedAt: null
      }
    });
    return { status: updated.status, expiresAt: updated.expiresAt, ...lifecycleInfo(updated, cfg) };
  }

  // Все объявления автора — включая pending/rejected/archived.
  // Для страницы «Мои объявления» в кабинете.
  async listMine(userId: string) {
    const items = await this.prisma.ad.findMany({
      where: { authorId: userId },
      orderBy: [{ createdAt: 'desc' }],
      include: {
        photos: { orderBy: { order: 'asc' } }
      }
    });
    const [w, cfg] = await Promise.all([this.getWeights(), lifecycleSettings(this.prisma)]);
    return {
      items: items.map((a) => publicAd({ ...a, nextBumpAt: this.nextBumpAt(a, w), ...lifecycleInfo(a, cfg) })),
      total: items.length
    };
  }

  // Неопубликованные (на модерации, отклонённые, скрытые) видят только автор и админы;
  // причину модерации — тоже только они.
  async findById(idOrShort: string, viewerId?: string) {
    // В адресе может быть короткий id (первые 8 символов)
    const id = await resolveAdId(this.prisma, idOrShort);
    if (!id) throw new NotFoundException('Ad not found');
    const ad = await this.prisma.ad.findUnique({
      where: { id },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            avatar: true,
            rating: true,
            reviewsCount: true,
            dealsCount: true,
            type: true,
            verified: true,
            contactMethod: true,
            createdAt: true,
            blockedAt: true,
            handle: { select: { username: true } },
            businessProfile: {
              select: {
                slug: true,
                name: true,
                verified: true
              }
            }
          }
        },
        photos: { orderBy: { order: 'asc' } },
        city: true,
        region: true
      }
    });
    if (!ad || ad.author.blockedAt) throw new NotFoundException('Ad not found');
    const privileged = viewerId === ad.authorId || (await isAdminUser(this.prisma, viewerId));
    if (ad.status !== AdStatus.approved && !privileged) throw new NotFoundException('Ad not found');
    const { blockedAt: _blocked, handle, ...authorRest } = ad.author;
    const author = { ...authorRest, username: handle?.username ?? null };
    const w = await this.getWeights();
    const lifecycle = privileged ? lifecycleInfo(ad, await lifecycleSettings(this.prisma)) : {};
    return publicAd({
      ...ad,
      moderationNotes: privileged ? ad.moderationNotes : null,
      author,
      nextBumpAt: this.nextBumpAt(ad, w),
      ...lifecycle
    });
  }

  // Определяет initialStatus нового объявления:
  // 1) Setting['moderation.autoApprove'] в БД (менеджится админом)
  // 2) fallback: env AD_AUTOAPPROVE
  // 3) fallback: approved (MVP-дефолт)
  private async initialAdStatus(): Promise<AdStatus> {
    const s = await this.prisma.setting.findUnique({
      where: { key: 'moderation.autoApprove' }
    });
    if (s) return s.value === 'true' ? AdStatus.approved : AdStatus.pending;
    if (process.env.AD_AUTOAPPROVE === 'false') return AdStatus.pending;
    return AdStatus.approved;
  }

  // Поля объявления из формы подачи — общие для создания и правки.
  private async adFields(dto: CreateAdDto) {
    const city = await this.prisma.city.findUnique({ where: { id: dto.cityId } });
    if (!city) throw new BadRequestException('Unknown city');
    const photoUrls = (dto.photoUrls || []).slice(0, 10);
    // Только фото, загруженные через наш /uploads: чужие ссылки — это хотлинк и пиксели слежки.
    const ownPrefix = `${this.s3.publicUrlBase}/ads/`;
    if (photoUrls.some((u) => !u.startsWith(ownPrefix))) {
      throw new BadRequestException('Фото можно добавить только загрузкой на сайт');
    }
    const attributes = sanitizeAttributes(dto.attributes);
    return {
      photoUrls,
      data: {
        section: dto.section,
        title: dto.title,
        price: dto.price ?? 0,
        priceTo: dto.priceTo ?? null,
        priceSuffix: dto.priceSuffix ?? null,
        description: dto.description ?? null,
        attributes: attributes ?? Prisma.DbNull,
        searchText: buildSearchText({ ...dto, attributes }),
        eventDate: dto.section === 'events' && dto.eventDate ? new Date(dto.eventDate) : null,
        address: dto.address?.trim() || city.name,
        categoryGroup: dto.categoryGroup ?? null,
        category: dto.category ?? null,
        cityId: city.id,
        regionId: city.regionId
      }
    };
  }

  // Автопубликация выключена — зовём админов в очередь модерации.
  private async notifyAdminsPending(ad: { id: string; title: string }, author: { id: string; name: string | null }, edited: boolean) {
    for (const adminId of await adminUserIds(this.prisma)) {
      if (adminId === author.id) continue;
      await this.notifications.notify(adminId, {
        type: 'ad_pending',
        title: edited ? `Изменено, на модерации: «${ad.title}»` : `На модерации: «${ad.title}»`,
        body: edited
          ? `${author.name || 'Пользователь'} изменил объявление — проверьте правки.`
          : `${author.name || 'Пользователь'} подал объявление — оно ждёт проверки.`,
        link: '/admin?tab=ads&status=pending',
        cta: 'Проверить'
      });
    }
  }

  // Картинка для превью ссылки в соцсетях: первое фото объявления в JPEG 1200×630.
  // Фото на сайте хранятся в WebP, а превью ссылок ВКонтакте WebP не показывает.
  private ogCache = new Map<string, Buffer>();

  async ogImage(idOrShort: string): Promise<Buffer> {
    const adId = await resolveAdId(this.prisma, idOrShort);
    if (!adId) throw new NotFoundException('No image');
    const ad = await this.prisma.ad.findUnique({
      where: { id: adId },
      select: { status: true, photos: { orderBy: { order: 'asc' }, take: 1, select: { url: true } } }
    });
    const url = ad?.status === AdStatus.approved ? ad.photos[0]?.url : undefined;
    // Только свои фото из хранилища: чужой адрес сюда попасть не может, но проверяем
    if (!url || !url.startsWith(`${this.s3.publicUrlBase}/`)) throw new NotFoundException('No image');
    const cached = this.ogCache.get(url);
    if (cached) return cached;
    const res = await fetch(url);
    if (!res.ok) throw new NotFoundException('No image');
    const jpeg = await sharp(Buffer.from(await res.arrayBuffer()))
      .resize({ width: 1200, height: 630, fit: 'cover', position: sharp.strategy.attention })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    // Небольшой кеш в памяти: соцсеть за превью приходит несколько раз подряд
    if (this.ogCache.size >= 100) this.ogCache.delete(this.ogCache.keys().next().value as string);
    this.ogCache.set(url, jpeg);
    return jpeg;
  }

  private async autoBumpAllowed(): Promise<boolean> {
    const row = await this.prisma.setting.findUnique({ where: { key: 'ranking.auto_bump_enabled' } });
    return (row?.value ?? 'true') === 'true';
  }

  // Автор включает или выключает автоподнятие своего объявления (страница продвижения).
  async setAutoBump(userId: string, adId: string, enabled: boolean) {
    const ad = await this.prisma.ad.findUnique({ where: { id: adId }, select: { authorId: true } });
    if (!ad) throw new NotFoundException('Ad not found');
    if (ad.authorId !== userId) throw new BadRequestException('Not your ad');
    if (enabled && !(await this.autoBumpAllowed())) throw new BadRequestException('Автоподнятие сейчас недоступно');
    const updated = await this.prisma.ad.update({ where: { id: adId }, data: { autoBump: enabled }, select: { autoBump: true } });
    return updated;
  }

  // opts.byAdmin — размещает администратор за пользователя: сразу опубликовано, с пометкой.
  async create(userId: string, dto: CreateAdDto, opts: { byAdmin?: boolean } = {}) {
    await assertNotBlocked(this.prisma, userId);
    const author = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!author) throw new BadRequestException('Unknown author');
    const { data, photoUrls } = await this.adFields(dto);

    const status = opts.byAdmin ? AdStatus.approved : await this.initialAdStatus();
    const { lifetimeDays } = await lifecycleSettings(this.prisma);

    const created = await this.prisma.ad.create({
      data: {
        id: await newAdId(this.prisma),
        ...data,
        autoBump: !!dto.autoBump && (await this.autoBumpAllowed()),
        placedByAdmin: !!opts.byAdmin,
        authorId: author.id,
        // Снапшот на момент публикации
        authorType: author.type,
        authorSnapshot: {
          name: author.name,
          avatar: author.avatar,
          rating: author.rating,
          verified: author.verified,
          type: author.type
        },
        // Определяется через Setting['moderation.autoApprove'] (админка) или env.
        status,
        publishedAt: status === AdStatus.approved ? new Date() : null,
        expiresAt: status === AdStatus.approved ? new Date(Date.now() + lifetimeDays * DAY_MS) : null,
        photos: photoUrls.length
          ? { create: photoUrls.map((url, idx) => ({ url, order: idx })) }
          : undefined
      },
      include: { photos: { orderBy: { order: 'asc' } } }
    });

    if (created.status === AdStatus.pending) await this.notifyAdminsPending(created, author, false);
    return created;
  }

  /**
   * Правка своего объявления. Модерация — как при подаче: при автопубликации изменения сразу
   * в ленте, иначе объявление уходит на проверку. Отклонённое или скрытое модератором после
   * правки всегда идёт на проверку — правкой нельзя обойти решение модератора.
   * Дата публикации не меняется: правка не поднимает объявление в ленте.
   */
  async update(userId: string, adId: string, dto: CreateAdDto) {
    await assertNotBlocked(this.prisma, userId);
    const ad = await this.prisma.ad.findUnique({
      where: { id: adId },
      select: { authorId: true, status: true, publishedAt: true, expiresAt: true, photos: { select: { url: true } } }
    });
    if (!ad) throw new NotFoundException('Ad not found');
    if (ad.authorId !== userId) throw new BadRequestException('Not your ad');
    const author = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
    const { data, photoUrls } = await this.adFields(dto);

    const underModeration = ad.status === AdStatus.rejected || ad.status === AdStatus.hidden;
    const status = underModeration ? AdStatus.pending : await this.initialAdStatus();
    const now = new Date();
    const { lifetimeDays } = await lifecycleSettings(this.prisma);
    const approved = status === AdStatus.approved;
    // Срок показа сохраняем, если объявление и так было в ленте; из архива — новый срок.
    const keepExpiry = ad.status === AdStatus.approved && ad.expiresAt && ad.expiresAt > now;

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.adPhoto.deleteMany({ where: { adId } });
      return tx.ad.update({
        where: { id: adId },
        data: {
          ...data,
          // Правка без поля autoBump (старые клиенты) — настройку не трогаем
          ...(dto.autoBump === undefined ? {} : { autoBump: dto.autoBump && (await this.autoBumpAllowed()) }),
          status,
          moderationNotes: null,
          publishedAt: approved ? (ad.publishedAt ?? now) : ad.publishedAt,
          expiresAt: approved ? (keepExpiry ? ad.expiresAt : new Date(now.getTime() + lifetimeDays * DAY_MS)) : ad.expiresAt,
          archivedAt: null,
          rejectedAt: null,
          lifecycleWarnedAt: null,
          photos: photoUrls.length ? { create: photoUrls.map((url, idx) => ({ url, order: idx })) } : undefined
        },
        include: { photos: { orderBy: { order: 'asc' } } }
      });
    });

    // Фото, которые убрали при правке, удаляем из хранилища.
    const removed = ad.photos.map((p) => p.url).filter((u) => !photoUrls.includes(u));
    if (removed.length) void this.s3.deleteByUrls(removed);

    if (updated.status === AdStatus.pending && author) await this.notifyAdminsPending(updated, author, true);
    return publicAd(updated);
  }

  // 45 000 — с запасом под лимит протокола sitemap в 50 000 URL на файл.
  async sitemapEntries() {
    const items = await this.prisma.ad.findMany({
      where: { status: AdStatus.approved, author: { blockedAt: null } },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 45_000
    });
    return { items };
  }

  // Счётчик просмотров: +1, если этот зритель не открывал объявление последние 24 часа.
  // Автор свои просмотры не накручивает.
  async registerView(adId: string, viewer: { userId?: string; sessionId: string }) {
    const ad = await this.prisma.ad.findUnique({
      where: { id: adId },
      select: { authorId: true, status: true, viewsCount: true }
    });
    if (!ad || ad.status !== AdStatus.approved) throw new NotFoundException('Ad not found');
    if (viewer.userId && viewer.userId === ad.authorId) {
      return { viewsCount: ad.viewsCount, counted: false };
    }

    const since = new Date(Date.now() - 24 * 60 * 60_000);
    const seen = await this.prisma.adView.findFirst({
      where: viewer.userId
        ? { adId, userId: viewer.userId, at: { gte: since } }
        : { adId, sessionId: viewer.sessionId, at: { gte: since } },
      select: { id: true }
    });
    if (seen) return { viewsCount: ad.viewsCount, counted: false };

    const [, updated] = await this.prisma.$transaction([
      this.prisma.adView.create({
        data: { adId, userId: viewer.userId ?? null, sessionId: viewer.sessionId, source: 'page' }
      }),
      this.prisma.ad.update({
        where: { id: adId },
        data: { viewsCount: { increment: 1 } },
        select: { viewsCount: true }
      })
    ]);
    return { viewsCount: updated.viewsCount, counted: true };
  }

  // Жалоба на объявление. Повторная жалоба того же пользователя, пока первая не разобрана, — не дубль.
  async report(userId: string, adId: string, dto: { reason: string; comment?: string }) {
    const ad = await this.prisma.ad.findUnique({ where: { id: adId }, select: { authorId: true } });
    if (!ad) throw new NotFoundException('Ad not found');
    if (ad.authorId === userId) throw new BadRequestException('Нельзя пожаловаться на своё объявление');
    const existing = await this.prisma.report.findFirst({
      where: { fromUserId: userId, targetKind: 'ad', targetId: adId, status: 'pending' },
      select: { id: true }
    });
    if (existing) return { ok: true };
    await this.prisma.report.create({
      data: {
        fromUserId: userId,
        targetKind: 'ad',
        targetId: adId,
        reason: dto.reason,
        comment: dto.comment?.trim() || null
      }
    });
    await this.prisma.ad.update({ where: { id: adId }, data: { reportsCount: { increment: 1 } } });
    return { ok: true };
  }

  async countsBySection(place?: string) {
    const placeWhere = await whereForPlace(this.prisma, place);
    const rows = await this.prisma.ad.groupBy({
      by: ['section'],
      where: { status: AdStatus.approved, ...placeWhere },
      _count: { _all: true }
    });
    const map: Record<string, number> = {};
    for (const r of rows) map[r.section] = r._count._all;
    return map;
  }
}
