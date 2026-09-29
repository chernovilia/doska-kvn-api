import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { assertNotBlocked } from '../auth/blocked';
import { readNumberSettings } from '../settings/read-settings';

function messagesWord(n: number) {
  const m10 = n % 10, m100 = n % 100;
  const w = m10 === 1 && m100 !== 11 ? 'сообщение' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'сообщения' : 'сообщений';
  return `${n} ${w}`;
}

const AUTHOR_SELECT = { id: true, name: true, avatar: true } as const;

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService
  ) {}

  /**
   * Можно ли оставить отзыв по диалогу: пользователь — участник, каждый написал не меньше
   * reviews.min_messages сообщений, с первого сообщения прошло reviews.min_hours часов,
   * и своего отзыва по этому диалогу ещё нет. Так отзыв оставляют после настоящего общения,
   * а не после «здравствуйте». Возвращает и уже оставленный отзыв, и прогресс для подсказки в чате.
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
    const [mine, theirs, first, review, need] = await Promise.all([
      this.prisma.message.count({ where: { conversationId, senderId: userId } }),
      this.prisma.message.count({ where: { conversationId, senderId: targetId } }),
      this.prisma.message.findFirst({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true }
      }),
      this.prisma.review.findUnique({
        where: { conversationId_authorId: { conversationId, authorId: userId } }
      }),
      this.requirements()
    ]);
    const readyAt = first ? new Date(first.createdAt.getTime() + need.hours * 3_600_000) : null;
    const enoughMessages = mine >= need.messages && theirs >= need.messages;
    const enoughTime = !!readyAt && readyAt.getTime() <= Date.now();
    const reason = review ? 'already' : !enoughMessages ? 'no_dialog' : !enoughTime ? 'too_early' : null;
    return {
      eligible: reason === null,
      reason,
      review,
      need,
      mine,
      theirs,
      readyAt,
      conv,
      targetId
    };
  }

  // Порог для отзыва — из админки (Setting), по умолчанию 4 сообщения с каждой стороны и 1 час.
  private async requirements() {
    const s = await readNumberSettings(this.prisma, { 'reviews.min_messages': 4, 'reviews.min_hours': 1 });
    return {
      messages: Math.max(1, Math.round(s['reviews.min_messages'])),
      hours: Math.max(0, s['reviews.min_hours'])
    };
  }

  async create(userId: string, dto: { conversationId: string; rating: number; text?: string }) {
    await assertNotBlocked(this.prisma, userId);
    const e = await this.eligibility(userId, dto.conversationId);
    if (e.reason === 'already') throw new ConflictException('Вы уже оставили отзыв по этой переписке');
    if (!e.eligible) {
      throw new ForbiddenException(
        `Отзыв можно оставить, когда каждый из вас написал хотя бы ${messagesWord(e.need.messages)} и с начала переписки прошёл ${e.need.hours} ч`
      );
    }

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
