import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { normalizeSearch } from '../ads/search-text';

function nameVariants(q: string) {
  const lower = q.toLowerCase();
  return [...new Set([q, lower, lower.charAt(0).toUpperCase() + lower.slice(1)])];
}
import { PrismaService } from '../prisma/prisma.service';
import { S3ClientService } from '../uploads/s3.client';
import { AdminGuard } from './admin.guard';
import { NotificationsService } from '../notifications/notifications.service';
import { ReviewsService } from '../reviews/reviews.service';

/**
 * Служебная админка. Все роуты защищены AdminGuard —
 * доступ только у юзеров из ADMIN_EMAILS или с role admin/owner.
 *
 * MVP: только чтение (stats + просмотр таблиц). Удаление добавим отдельно
 * ниже — так классификатору проще увидеть намерения.
 */
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3ClientService,
    private readonly notifications: NotificationsService,
    private readonly reviews: ReviewsService
  ) {}

  // ── Модерация ────────────────────────────────────────────────────
  // Ключ Setting: 'moderation.autoApprove' ('true' | 'false').
  // Если запись отсутствует — считаем что автопубликация включена (MVP).

  @Get('moderation')
  async getModeration() {
    const s = await this.prisma.setting.findUnique({
      where: { key: 'moderation.autoApprove' }
    });
    const value = s?.value ?? 'true';
    return { autoApprove: value === 'true' };
  }

  @Patch('moderation')
  async setModeration(@Body() body: { autoApprove?: boolean }) {
    if (typeof body?.autoApprove !== 'boolean') {
      throw new BadRequestException('autoApprove: boolean required');
    }
    const value = body.autoApprove ? 'true' : 'false';
    await this.prisma.setting.upsert({
      where: { key: 'moderation.autoApprove' },
      update: { value },
      create: {
        key: 'moderation.autoApprove',
        value,
        description: 'Публиковать новые объявления сразу (true) или через модерацию (false)'
      }
    });
    return { autoApprove: body.autoApprove };
  }

  @Get('stats')
  async stats() {
    const day = 24 * 60 * 60_000;
    const week = new Date(Date.now() - 7 * day);
    const [
      users, usersNew7d, usersOnboarded, blockedUsers,
      ads, approvedAds, pendingAds, rejectedAds, adsNew7d,
      conversations, messages7d, reviews, favorites, views, pendingReports,
      byCity, daily,
      adPhotos, refreshTokens, emailCodes
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: week } } }),
      this.prisma.user.count({ where: { onboardedAt: { not: null } } }),
      this.prisma.user.count({ where: { blockedAt: { not: null } } }),
      this.prisma.ad.count(),
      this.prisma.ad.count({ where: { status: 'approved' } }),
      this.prisma.ad.count({ where: { status: 'pending' } }),
      this.prisma.ad.count({ where: { status: 'rejected' } }),
      this.prisma.ad.count({ where: { createdAt: { gte: week } } }),
      this.prisma.conversation.count(),
      this.prisma.message.count({ where: { createdAt: { gte: week } } }),
      this.prisma.review.count(),
      this.prisma.favorite.count(),
      this.prisma.ad.aggregate({ _sum: { viewsCount: true } }),
      this.prisma.report.count({ where: { status: 'pending' } }),
      this.prisma.ad.groupBy({ by: ['cityId'], where: { status: 'approved' }, _count: { _all: true } }),
      // Новые пользователи и объявления по дням за 14 дней (по Москве).
      this.prisma.$queryRaw<{ day: Date; users: bigint; ads: bigint }[]>`
        SELECT d.day,
          (SELECT count(*) FROM "User" u WHERE date_trunc('day', u."createdAt" AT TIME ZONE 'Europe/Moscow') = d.day) AS users,
          (SELECT count(*) FROM "Ad" a WHERE date_trunc('day', a."createdAt" AT TIME ZONE 'Europe/Moscow') = d.day) AS ads
        FROM generate_series(
          date_trunc('day', now() AT TIME ZONE 'Europe/Moscow') - interval '13 days',
          date_trunc('day', now() AT TIME ZONE 'Europe/Moscow'),
          interval '1 day'
        ) AS d(day)
        ORDER BY d.day`,
      this.prisma.adPhoto.count(),
      this.prisma.refreshToken.count(),
      this.prisma.emailCode.count()
    ]);
    return {
      users, usersNew7d, usersOnboarded, blockedUsers,
      ads, approvedAds, pendingAds, rejectedAds, adsNew7d,
      conversations, messages7d, reviews, favorites,
      views: views._sum.viewsCount ?? 0,
      pendingReports,
      byCity: byCity.map((c) => ({ cityId: c.cityId, count: c._count._all })).sort((a, b) => b.count - a.count),
      daily: daily.map((d) => ({
        day: d.day.toISOString().slice(0, 10),
        users: Number(d.users),
        ads: Number(d.ads)
      })),
      tech: { adPhotos, refreshTokens, emailCodes }
    };
  }

  @Get('users')
  async users(
    @Query('limit') limit = '100',
    @Query('offset') offset = '0',
    @Query('q') q?: string,
    @Query('blocked') blocked?: string
  ) {
    const take = Math.min(500, Math.max(1, Number(limit) || 100));
    const skip = Math.max(0, Number(offset) || 0);
    const query = q?.trim();
    const where: Prisma.UserWhereInput = {
      ...(query
        ? {
            // Имя: локаль БД — C, ILIKE не складывает кириллицу; пробуем как ввели,
            // строчными и с заглавной — этого хватает для поиска по имени.
            OR: [
              { email: { contains: query, mode: 'insensitive' } },
              ...nameVariants(query).map((v) => ({ name: { contains: v } })),
              { id: query }
            ]
          }
        : {}),
      ...(blocked === '1' ? { blockedAt: { not: null } } : {})
    };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        select: {
          id: true,
          email: true,
          phone: true,
          name: true,
          avatar: true,
          role: true,
          type: true,
          homeCityId: true,
          contactMethod: true,
          notifyEmail: true,
          verified: true,
          onboardedAt: true,
          createdAt: true,
          lastSeenAt: true,
          blockedAt: true,
          blockReason: true,
          rating: true,
          reviewsCount: true,
          dealsCount: true,
          _count: { select: { ads: true } }
        }
      }),
      this.prisma.user.count({ where })
    ]);
    return { items, total };
  }

  // Блокировка: не может публиковать, писать, загружать фото и оставлять отзывы;
  // его объявления и страница скрыты. Разблокировка всё возвращает.
  @Patch('users/:id/block')
  async blockUser(
    @Param('id') id: string,
    @Body() body: { blocked?: boolean; reason?: string },
    @Req() req: { userId?: string }
  ) {
    if (id === req.userId) throw new BadRequestException('Нельзя заблокировать себя');
    const target = await this.prisma.user.findUnique({ where: { id }, select: { role: true, email: true } });
    if (!target) throw new BadRequestException('User not found');
    const adminEmails = (process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map((e) => e.trim());
    if (body.blocked && (target.role === 'admin' || target.role === 'owner' || adminEmails.includes((target.email || '').toLowerCase()))) {
      throw new BadRequestException('Нельзя заблокировать администратора');
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '';
    const user = await this.prisma.user.update({
      where: { id },
      data: body.blocked
        ? { blockedAt: new Date(), blockReason: reason || null }
        : { blockedAt: null, blockReason: null },
      select: { id: true, blockedAt: true, blockReason: true }
    });
    // Разлогиниваем: отзываем refresh-токены заблокированного.
    if (body.blocked) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() }
      });
    }
    return user;
  }

  @Get('ads')
  async ads(
    @Query('limit') limit = '100',
    @Query('offset') offset = '0',
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('authorId') authorId?: string
  ) {
    const take = Math.min(500, Math.max(1, Number(limit) || 100));
    const skip = Math.max(0, Number(offset) || 0);
    const allowedStatuses = ['pending', 'approved', 'rejected', 'archived'];
    const query = q?.trim();
    const where: Prisma.AdWhereInput = {
      ...(status && allowedStatuses.includes(status) ? { status: status as any } : {}),
      ...(authorId ? { authorId } : {}),
      ...(query
        ? {
            OR: [{ searchText: { contains: normalizeSearch(query) } }, { id: query }]
          }
        : {})
    };
    const [items, total] = await Promise.all([
      this.prisma.ad.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        select: {
          id: true,
          title: true,
          section: true,
          categoryGroup: true,
          category: true,
          price: true,
          priceTo: true,
          priceSuffix: true,
          status: true,
          moderationNotes: true,
          cityId: true,
          regionId: true,
          authorId: true,
          authorType: true,
          createdAt: true,
          viewsCount: true,
          favoritesCount: true,
          reportsCount: true,
          photos: { orderBy: { order: 'asc' }, take: 1, select: { url: true } },
          author: {
            select: { id: true, email: true, name: true, blockedAt: true }
          }
        }
      }),
      this.prisma.ad.count({ where })
    ]);
    return { items, total };
  }

  @Get('ads/:id')
  async adDetail(@Param('id') id: string) {
    const ad = await this.prisma.ad.findUnique({
      where: { id },
      include: {
        photos: { orderBy: { order: 'asc' } },
        author: {
          select: {
            id: true, email: true, phone: true, name: true, role: true,
            contactMethod: true, createdAt: true, onboardedAt: true,
            rating: true, dealsCount: true, homeCityId: true
          }
        }
      }
    });
    if (!ad) throw new BadRequestException('Ad not found');
    return ad;
  }

  @Patch('ads/:id/status')
  async setAdStatus(
    @Param('id') id: string,
    @Body() body: { status?: string; note?: string }
  ) {
    const allowed = ['pending', 'approved', 'rejected', 'archived'];
    if (!body?.status || !allowed.includes(body.status)) {
      throw new BadRequestException(`status must be one of ${allowed.join(', ')}`);
    }
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
    const before = await this.prisma.ad.findUnique({
      where: { id },
      select: { status: true, authorId: true, title: true }
    });
    if (!before) throw new BadRequestException('Ad not found');
    const ad = await this.prisma.ad.update({
      where: { id },
      data: {
        status: body.status as any,
        moderationNotes: note || null,
        publishedAt: body.status === 'approved' ? new Date() : undefined
      },
      select: { id: true, status: true, moderationNotes: true }
    });

    // Автору — только о смене статуса, повторное «одобрить» не шлёт письмо ещё раз.
    if (before.status !== body.status) {
      if (body.status === 'approved') {
        await this.notifications.notify(before.authorId, {
          type: 'ad_approved',
          title: `Объявление опубликовано: «${before.title}»`,
          body: 'Его уже видят в ленте.',
          link: `/ad/${id}`,
          cta: 'Открыть объявление'
        });
      } else if (body.status === 'rejected') {
        await this.notifications.notify(before.authorId, {
          type: 'ad_rejected',
          title: `Объявление отклонено: «${before.title}»`,
          body: note ? `Причина: ${note}` : 'Оно не прошло модерацию. Проверьте правила и подайте заново.',
          link: `/ad/${id}`,
          cta: 'Посмотреть'
        });
      }
    }
    return ad;
  }

  @Delete('ads/:id')
  async deleteAd(@Param('id') id: string, @Query('reason') reason?: string) {
    const target = await this.prisma.ad.findUnique({
      where: { id },
      select: { authorId: true, title: true }
    });
    const photos = await this.prisma.adPhoto.findMany({
      where: { adId: id },
      select: { url: true }
    });
    await this.prisma.$transaction([
      this.prisma.adPhoto.deleteMany({ where: { adId: id } }),
      this.prisma.adView.deleteMany({ where: { adId: id } }),
      this.prisma.adPromo.deleteMany({ where: { adId: id } }),
      this.prisma.favorite.deleteMany({ where: { adId: id } }),
      this.prisma.report.deleteMany({ where: { targetKind: 'ad', targetId: id } }),
      this.prisma.ad.delete({ where: { id } })
    ]);
    void this.s3.deleteByUrls(photos.map((p) => p.url));
    if (target) {
      const why = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
      await this.notifications.notify(target.authorId, {
        type: 'ad_removed',
        title: `Объявление удалено модератором: «${target.title}»`,
        body: why ? `Причина: ${why}` : 'Оно нарушало правила площадки.',
        link: '/terms',
        cta: 'Правила площадки'
      });
    }
    return { ok: true };
  }

  // ── Жалобы ───────────────────────────────────────────────────────

  @Get('reports')
  async reports(@Query('status') status = 'pending') {
    const allowed = ['pending', 'resolved', 'dismissed'];
    const items = await this.prisma.report.findMany({
      where: allowed.includes(status) ? { status: status as any } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        ad: {
          select: {
            id: true, title: true, status: true, reportsCount: true,
            photos: { orderBy: { order: 'asc' }, take: 1, select: { url: true } },
            author: { select: { id: true, name: true, email: true, blockedAt: true } }
          }
        }
      }
    });
    const reporterIds = [...new Set(items.map((r) => r.fromUserId))];
    const reporters = await this.prisma.user.findMany({
      where: { id: { in: reporterIds } },
      select: { id: true, name: true, email: true }
    });
    const byId = new Map(reporters.map((u) => [u.id, u]));
    return { items: items.map((r) => ({ ...r, reporter: byId.get(r.fromUserId) || null })) };
  }

  // Разобрать жалобу: resolved — меры приняты, dismissed — жалоба не подтвердилась.
  // Закрывает сразу все открытые жалобы на то же объявление.
  @Patch('reports/:id')
  async resolveReport(
    @Param('id') id: string,
    @Body() body: { status?: string },
    @Req() req: { userId?: string }
  ) {
    if (!body?.status || !['resolved', 'dismissed'].includes(body.status)) {
      throw new BadRequestException('status must be resolved or dismissed');
    }
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) throw new BadRequestException('Report not found');
    const { count } = await this.prisma.report.updateMany({
      where: { targetKind: report.targetKind, targetId: report.targetId, status: 'pending' },
      data: { status: body.status as any, resolvedAt: new Date(), resolvedById: req.userId ?? null }
    });
    return { ok: true, closed: count };
  }

  // ── Отзывы ───────────────────────────────────────────────────────

  @Get('reviews')
  listReviews() {
    return this.reviews.adminList();
  }

  @Delete('reviews/:id')
  deleteReview(@Param('id') id: string) {
    return this.reviews.adminDelete(id);
  }

  @Delete('users/:id')
  async deleteUser(@Param('id') id: string) {
    // Отзывы пользователя удалятся каскадом — рейтинги тех, о ком он писал, пересчитаем.
    const reviewedTargets = await this.prisma.review.findMany({
      where: { authorId: id },
      select: { targetId: true },
      distinct: ['targetId']
    });
    const photos = await this.prisma.adPhoto.findMany({
      where: { ad: { authorId: id } },
      select: { url: true }
    });
    await this.prisma.$transaction([
      this.prisma.adPhoto.deleteMany({ where: { ad: { authorId: id } } }),
      this.prisma.adView.deleteMany({ where: { ad: { authorId: id } } }),
      this.prisma.adPromo.deleteMany({ where: { ad: { authorId: id } } }),
      this.prisma.favorite.deleteMany({ where: { ad: { authorId: id } } }),
      this.prisma.favorite.deleteMany({ where: { userId: id } }),
      this.prisma.report.deleteMany({ where: { fromUserId: id } }),
      this.prisma.ad.deleteMany({ where: { authorId: id } }),
      this.prisma.walletTransaction.deleteMany({ where: { wallet: { userId: id } } }),
      this.prisma.wallet.deleteMany({ where: { userId: id } }),
      this.prisma.subscription.deleteMany({ where: { userId: id } }),
      this.prisma.payment.deleteMany({ where: { userId: id } }),
      this.prisma.businessProfile.deleteMany({ where: { userId: id } }),
      this.prisma.refreshToken.deleteMany({ where: { userId: id } }),
      this.prisma.user.delete({ where: { id } })
    ]);
    void this.s3.deleteByUrls(photos.map((p) => p.url));
    for (const r of reviewedTargets) await this.reviews.recompute(r.targetId);
    return { ok: true };
  }

  @Post('wipe')
  async wipe(@Query('confirm') confirm?: string) {
    if (confirm !== 'WIPE_ALL') {
      throw new BadRequestException('Pass ?confirm=WIPE_ALL to proceed');
    }
    const photos = await this.prisma.adPhoto.findMany({ select: { url: true } });
    const [
      adPhotos, adPromos, adViews, favorites, reports, ads,
      walletTx, wallets, subscriptions, payments, businessProfiles,
      refreshTokens, emailCodes, trustedDevices, analyticsEvents, users
    ] = await this.prisma.$transaction([
      this.prisma.adPhoto.deleteMany({}),
      this.prisma.adPromo.deleteMany({}),
      this.prisma.adView.deleteMany({}),
      this.prisma.favorite.deleteMany({}),
      this.prisma.report.deleteMany({}),
      this.prisma.ad.deleteMany({}),
      this.prisma.walletTransaction.deleteMany({}),
      this.prisma.wallet.deleteMany({}),
      this.prisma.subscription.deleteMany({}),
      this.prisma.payment.deleteMany({}),
      this.prisma.businessProfile.deleteMany({}),
      this.prisma.refreshToken.deleteMany({}),
      this.prisma.emailCode.deleteMany({}),
      this.prisma.trustedDevice.deleteMany({}),
      this.prisma.analyticsEvent.deleteMany({}),
      this.prisma.user.deleteMany({})
    ]);
    void this.s3.deleteByUrls(photos.map((p) => p.url));
    return {
      ok: true,
      deleted: {
        adPhotos: adPhotos.count,
        adPromos: adPromos.count,
        adViews: adViews.count,
        favorites: favorites.count,
        reports: reports.count,
        ads: ads.count,
        walletTx: walletTx.count,
        wallets: wallets.count,
        subscriptions: subscriptions.count,
        payments: payments.count,
        businessProfiles: businessProfiles.count,
        refreshTokens: refreshTokens.count,
        emailCodes: emailCodes.count,
        trustedDevices: trustedDevices.count,
        analyticsEvents: analyticsEvents.count,
        users: users.count
      }
    };
  }
}
