import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ListAdsDto } from './dto/list-ads.dto';
import { CreateAdDto } from './dto/create-ad.dto';
import { AdStatus, Prisma } from '@prisma/client';

/**
 * Резолвер «места»: id региона или id города.
 * Возвращает WHERE-условие для Ad.
 */
async function whereForPlace(prisma: PrismaService, place?: string) {
  if (!place) return {};
  const region = await prisma.region.findUnique({ where: { id: place } });
  if (region) return { regionId: region.id };
  const city = await prisma.city.findUnique({ where: { id: place } });
  if (city) return { cityId: city.id };
  return {};
}

@Injectable()
export class AdsService {
  constructor(private readonly prisma: PrismaService) {}

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

    const orderBy: Prisma.AdOrderByWithRelationInput[] =
      q.sort === 'recent'
        ? [{ createdAt: 'desc' }]
        : [{ top: 'desc' }, { createdAt: 'desc' }];

    const [items, total] = await Promise.all([
      this.prisma.ad.findMany({
        where,
        orderBy,
        take: q.limit,
        skip: q.offset,
        include: {
          author: { select: { id: true, name: true, avatar: true, rating: true, dealsCount: true, type: true } },
          photos: { orderBy: { order: 'asc' } }
        }
      }),
      this.prisma.ad.count({ where })
    ]);

    return { items, total };
  }

  async findById(id: string) {
    const ad = await this.prisma.ad.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, name: true, avatar: true, rating: true, dealsCount: true, type: true, verified: true } },
        photos: { orderBy: { order: 'asc' } },
        city: true,
        region: true
      }
    });
    if (!ad) throw new NotFoundException('Ad not found');
    return ad;
  }

  async create(userId: string, dto: CreateAdDto) {
    const city = await this.prisma.city.findUnique({ where: { id: dto.cityId } });
    if (!city) throw new BadRequestException('Unknown city');

    const author = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!author) throw new BadRequestException('Unknown author (X-Debug-User-Id points to nonexistent user)');

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
        status: AdStatus.pending
      }
    });
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
