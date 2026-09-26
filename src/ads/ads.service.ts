import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { S3ClientService } from '../uploads/s3.client';
import { ListAdsDto } from './dto/list-ads.dto';
import { CreateAdDto } from './dto/create-ad.dto';
import { AdStatus, Prisma, UserType } from '@prisma/client';

async function whereForPlace(prisma: PrismaService, place?: string) {
  if (!place) return {};
  const region = await prisma.region.findUnique({ where: { id: place } });
  if (region) return { regionId: region.id };
  const city = await prisma.city.findUnique({ where: { id: place } });
  if (city) return { cityId: city.id };
  return {};
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
}

@Injectable()
export class AdsService {
  private weightsCache: { data: RankingWeights; expires: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3ClientService
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
      boostBonus: parseFloat(map['ranking.boost_bonus'] ?? '0.15')
    };
    this.weightsCache = { data: w, expires: Date.now() + 60_000 };
    return w;
  }

  private computeScore(ad: any, w: RankingWeights): number {
    const now = Date.now();
    const hours = (now - new Date(ad.createdAt).getTime()) / 3_600_000;
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

    // Boost 24 часа
    if (ad.boostedAt) {
      const boostHours = (now - new Date(ad.boostedAt).getTime()) / 3_600_000;
      if (boostHours < 24) score += w.boostBonus;
    }
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
    const where: Prisma.AdWhereInput = {
      status: AdStatus.approved,
      ...placeWhere,
      ...(q.section ? { section: q.section } : {}),
      ...(q.chip
        ? {
            OR: [
              { category: { contains: q.chip, mode: 'insensitive' } },
              { title: { contains: q.chip, mode: 'insensitive' } }
            ]
          }
        : {}),
      ...(q.search
        ? {
            OR: [
              { title: { contains: q.search, mode: 'insensitive' } },
              { description: { contains: q.search, mode: 'insensitive' } },
              { address: { contains: q.search, mode: 'insensitive' } }
            ]
          }
        : {})
    };

    // Тянем чуть с запасом: score-сортировка + правила потом обрежут.
    const takeRaw = Math.min(300, (q.limit ?? 100) + 100);

    const [rawItems, total] = await Promise.all([
      this.prisma.ad.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }], // предварительная сортировка
        take: takeRaw,
        include: {
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
          photos: { orderBy: { order: 'asc' } }
        }
      }),
      this.prisma.ad.count({ where })
    ]);

    // Ранкинг: либо recent (по дате), либо top (по score).
    let sorted;
    if (q.sort === 'recent') {
      sorted = rawItems; // уже отсортированы по createdAt DESC
    } else {
      const w = await this.getWeights();
      const withScore = rawItems.map((a) => ({ ...a, _score: this.computeScore(a, w) }));
      withScore.sort((a, b) => b._score - a._score);
      sorted = this.applyRules(withScore, w);
    }

    const items = sorted.slice(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? 100));
    return { items, total };
  }

  // Юзер удаляет своё объявление. Проверяем что автор совпадает — иначе 403.
  async removeOwn(userId: string, adId: string) {
    const ad = await this.prisma.ad.findUnique({
      where: { id: adId },
      select: { authorId: true, photos: { select: { url: true } } }
    });
    if (!ad) throw new BadRequestException('Ad not found');
    if (ad.authorId !== userId) throw new BadRequestException('Not your ad');
    await this.prisma.$transaction([
      this.prisma.adPhoto.deleteMany({ where: { adId } }),
      this.prisma.adView.deleteMany({ where: { adId } }),
      this.prisma.adPromo.deleteMany({ where: { adId } }),
      this.prisma.favorite.deleteMany({ where: { adId } }),
      this.prisma.report.deleteMany({ where: { targetKind: 'ad', targetId: adId } }),
      this.prisma.ad.delete({ where: { id: adId } })
    ]);
    void this.s3.deleteByUrls(ad.photos.map((p) => p.url));
    return { ok: true };
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
    return { items, total: items.length };
  }

  async findById(id: string) {
    const ad = await this.prisma.ad.findUnique({
      where: { id },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            avatar: true,
            rating: true,
            dealsCount: true,
            type: true,
            verified: true,
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
    if (!ad) throw new NotFoundException('Ad not found');
    return ad;
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

  async create(userId: string, dto: CreateAdDto) {
    const city = await this.prisma.city.findUnique({ where: { id: dto.cityId } });
    if (!city) throw new BadRequestException('Unknown city');

    const author = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!author) throw new BadRequestException('Unknown author');

    const status = await this.initialAdStatus();
    const photoUrls = (dto.photoUrls || []).slice(0, 10);

    return this.prisma.ad.create({
      data: {
        section: dto.section,
        title: dto.title,
        price: dto.price ?? 0,
        priceSuffix: dto.priceSuffix,
        description: dto.description,
        address: dto.address ?? city.name,
        phone: dto.phone,
        avitoUrl: dto.avitoUrl,
        categoryGroup: dto.categoryGroup,
        category: dto.category,
        cityId: city.id,
        regionId: city.regionId,
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
        photos: photoUrls.length
          ? {
              create: photoUrls.map((url, idx) => ({
                url,
                order: idx
              }))
            }
          : undefined
      },
      include: { photos: { orderBy: { order: 'asc' } } }
    });
  }

  // 45 000 — с запасом под лимит протокола sitemap в 50 000 URL на файл.
  async sitemapEntries() {
    const items = await this.prisma.ad.findMany({
      where: { status: AdStatus.approved },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 45_000
    });
    return { items };
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
