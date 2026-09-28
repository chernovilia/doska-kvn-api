import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AdStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Автор в карточке — те же поля, что в ленте.
const AD_INCLUDE = {
  author: {
    select: { id: true, name: true, avatar: true, rating: true, dealsCount: true, type: true, verified: true }
  },
  photos: { orderBy: { order: 'asc' as const } }
};

@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  // id избранных — чтобы лента сразу рисовала заполненные сердечки.
  async ids(userId: string) {
    const rows = await this.prisma.favorite.findMany({
      where: { userId },
      select: { adId: true },
      orderBy: { at: 'desc' },
      take: 1000
    });
    return { ids: rows.map((r) => r.adId) };
  }

  // Избранные объявления, свежие сверху. Снятые с публикации не показываем.
  async list(userId: string) {
    const rows = await this.prisma.favorite.findMany({
      where: { userId, ad: { status: AdStatus.approved } },
      orderBy: { at: 'desc' },
      take: 200,
      include: { ad: { include: AD_INCLUDE } }
    });
    return { items: rows.map((r) => r.ad) };
  }

  async add(userId: string, adId: string) {
    const ad = await this.prisma.ad.findUnique({
      where: { id: adId },
      select: { status: true, authorId: true }
    });
    if (!ad || ad.status !== AdStatus.approved) throw new NotFoundException('Ad not found');
    if (ad.authorId === userId) throw new BadRequestException('Своё объявление нельзя добавить в избранное');
    try {
      await this.prisma.$transaction([
        this.prisma.favorite.create({ data: { userId, adId } }),
        this.prisma.ad.update({ where: { id: adId }, data: { favoritesCount: { increment: 1 } } })
      ]);
    } catch (err) {
      // Уже в избранном (повторный тап, две вкладки) — не ошибка.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    }
    return { ok: true };
  }

  async remove(userId: string, adId: string) {
    const { count } = await this.prisma.favorite.deleteMany({ where: { userId, adId } });
    if (count) {
      await this.prisma.ad.updateMany({
        where: { id: adId, favoritesCount: { gt: 0 } },
        data: { favoritesCount: { decrement: 1 } }
      });
    }
    return { ok: true };
  }
}
