import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const AUTHOR_SELECT = { id: true, name: true, avatar: true } as const;

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService
  ) {}

  /**
   * Можно ли оставить отзыв по диалогу: пользователь — участник, писали оба,
   * и своего отзыва по этому диалогу ещё нет. Возвращает и уже оставленный отзыв.
   */
  async eligibility(userId: string, conversationId: string) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, buyerId: true, sellerId: true, adTitle: true }
    });
    if (!conv || (conv.buyerId !== userId && conv.sellerId !== userId)) {
      throw new NotFoundException('Conversation not found');
    }
    const targetId = conv.buyerId === userId ? conv.sellerId : conv.buyerId;
    const [mine, theirs, review] = await Promise.all([
      this.prisma.message.count({ where: { conversationId, senderId: userId } }),
      this.prisma.message.count({ where: { conversationId, senderId: targetId } }),
      this.prisma.review.findUnique({
        where: { conversationId_authorId: { conversationId, authorId: userId } }
      })
    ]);
    const bothWrote = mine > 0 && theirs > 0;
    return {
      eligible: bothWrote && !review,
      reason: review ? 'already' : bothWrote ? null : 'no_dialog',
      review,
      conv,
      targetId
    };
  }

  async create(userId: string, dto: { conversationId: string; rating: number; text?: string }) {
    const e = await this.eligibility(userId, dto.conversationId);
    if (e.reason === 'already') throw new ConflictException('Вы уже оставили отзыв по этой переписке');
    if (!e.eligible) throw new ForbiddenException('Отзыв можно оставить, когда вы оба написали в переписке');

    const text = dto.text?.trim() || null;
    const review = await this.prisma.review.create({
      data: {
        authorId: userId,
        targetId: e.targetId,
        conversationId: e.conv.id,
        adTitle: e.conv.adTitle,
        rating: dto.rating,
        text
      },
      include: { author: { select: AUTHOR_SELECT } }
    });
    await this.recompute(e.targetId);

    await this.notifications.notify(e.targetId, {
      type: 'review_new',
      title: `Новый отзыв: ${'★'.repeat(dto.rating)}${'☆'.repeat(5 - dto.rating)}`,
      body: `${review.author.name || 'Пользователь'} по объявлению «${e.conv.adTitle}»${text ? `:\n${text}` : ''}`,
      link: `/user/${e.targetId}#reviews`,
      cta: 'Посмотреть отзыв'
    });
    return review;
  }

  // Отзывы о пользователе — для его публичной страницы и профиля.
  async listFor(targetId: string) {
    const items = await this.prisma.review.findMany({
      where: { targetId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { author: { select: AUTHOR_SELECT } }
    });
    return { items };
  }

  async adminList() {
    const items = await this.prisma.review.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        author: { select: AUTHOR_SELECT },
        target: { select: AUTHOR_SELECT }
      }
    });
    return { items };
  }

  async adminDelete(id: string) {
    const review = await this.prisma.review.findUnique({ where: { id }, select: { targetId: true } });
    if (!review) throw new NotFoundException('Review not found');
    await this.prisma.review.delete({ where: { id } });
    await this.recompute(review.targetId);
    return { ok: true };
  }

  // Рейтинг и число отзывов в User — кэш для карточек и страниц, пересчитываем целиком.
  async recompute(targetId: string) {
    const agg = await this.prisma.review.aggregate({
      where: { targetId },
      _avg: { rating: true },
      _count: { _all: true }
    });
    await this.prisma.user.updateMany({
      where: { id: targetId },
      data: {
        rating: Math.round((agg._avg.rating ?? 0) * 10) / 10,
        reviewsCount: agg._count._all
      }
    });
  }
}
