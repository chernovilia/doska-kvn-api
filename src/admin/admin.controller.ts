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

// Настройки, которыми управляет админка. default — если записи в БД ещё нет.
const MANAGED_SETTINGS: Record<
  string,
  { label: string; hint: string; type: 'bool' | 'number'; default: string; min: number; max: number; step?: number }
> = {
  'moderation.autoApprove': {
    label: 'Автопубликация',
    hint: 'Выключено — новые объявления ждут одобрения в админке',
    type: 'bool', default: 'true', min: 0, max: 1
  },
  'ads.lifetime_days': {
    label: 'Срок показа объявления, дней',
    hint: 'Потом — в архив; автор может продлить',
    type: 'number', default: '60', min: 7, max: 365, step: 1
  },
  'ads.archive_keep_days': {
    label: 'Хранить архив, дней',
    hint: 'Потом объявление удаляется вместе с фото',
    type: 'number', default: '90', min: 7, max: 365, step: 1
  },
  'ads.rejected_keep_days': {
    label: 'Хранить отклонённые, дней',
    hint: 'Потом удаляются вместе с фото',
    type: 'number', default: '30', min: 3, max: 365, step: 1
  },
  'ads.lifecycle_warn_days': {
    label: 'Предупреждать за, дней',
    hint: 'Письмо автору перед архивом и перед удалением',
    type: 'number', default: '3', min: 0, max: 14, step: 1
  },
  'reviews.min_messages': {
    label: 'Отзыв: сообщений от каждого',
    hint: 'Сколько сообщений должен написать каждый в переписке, чтобы оценить друг друга',
    type: 'number', default: '4', min: 1, max: 30, step: 1
  },
  'reviews.min_hours': {
    label: 'Отзыв: часов с начала переписки',
    hint: 'Не раньше этого времени после первого сообщения',
    type: 'number', default: '1', min: 0, max: 72, step: 1
  },
  'ranking.bump_cooldown_days': {
    label: 'Поднять можно через, дней',
    hint: 'После публикации или прошлого подъёма',
    type: 'number', default: '10', min: 1, max: 90, step: 1
  },
  'ranking.boost_bonus': {
    label: 'Бонус новым и поднятым',
    hint: 'Прибавка к рейтингу на 24 часа; 0.15 ≈ сразу в топ',
    type: 'number', default: '0.15', min: 0, max: 1, step: 0.05
  },
  'ranking.freshness_days': {
    label: 'Свежесть, дней',
    hint: 'За сколько дней объявление «стареет» до нуля',
    type: 'number', default: '10', min: 1, max: 90, step: 1
  },
  'ranking.weight.freshness': { label: 'Вес: свежесть', hint: '', type: 'number', default: '0.35', min: 0, max: 1, step: 0.05 },
  'ranking.weight.quality': { label: 'Вес: качество (фото, описание)', hint: '', type: 'number', default: '0.10', min: 0, max: 1, step: 0.05 },
  'ranking.weight.trust': { label: 'Вес: доверие к автору', hint: 'Рейтинг и проверка', type: 'number', default: '0.15', min: 0, max: 1, step: 0.05 },
  'ranking.weight.engagement': { label: 'Вес: интерес (просмотры)', hint: '', type: 'number', default: '0.10', min: 0, max: 1, step: 0.05 },
  'ranking.same_author_max_top10': {
    label: 'Макс. объявлений одного автора в топ-10',
    hint: 'Чтобы один продавец не занял всю ленту',
    type: 'number', default: '3', min: 1, max: 10, step: 1
  }
};

function nameVariants(q: string) {
  const lower = q.toLowerCase();
  return [...new Set([q, lower, lower.charAt(0).toUpperCase() + lower.slice(1)])];
}
import { PrismaService } from '../prisma/prisma.service';
import { S3ClientService } from '../uploads/s3.client';
import { AdminGuard } from './admin.guard';
import { NotificationsService } from '../notifications/notifications.service';
import { ReviewsService } from '../reviews/reviews.service';
import { SupportService } from '../support/support.service';
import { DAY_MS, lifecycleSettings, purgeAd } from '../ads/lifecycle';

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
    private readonly reviews: ReviewsService,
    private readonly support: SupportService
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
      ads, approvedAds, pendingAds, rejectedAds, hiddenAds, archivedAds, adsNew7d,
      conversations, messages7d, reviews, favorites, views, pendingReports, openTickets,
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
      this.prisma.ad.count({ where: { status: 'hidden' } }),
      this.prisma.ad.count({ where: { status: 'archived' } }),
      this.prisma.ad.count({ where: { createdAt: { gte: week } } }),
      this.prisma.conversation.count(),
      this.prisma.message.count({ where: { createdAt: { gte: week } } }),
      this.prisma.review.count(),
      this.prisma.favorite.count(),
      this.prisma.ad.aggregate({ _sum: { viewsCount: true } }),
      this.prisma.report.count({ where: { status: 'pending' } }),
      this.prisma.supportTicket.count({ where: { status: 'open' } }),
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
      ads, approvedAds, pendingAds, rejectedAds, hiddenAds, archivedAds, adsNew7d,
      conversations, messages7d, reviews, favorites,
      views: views._sum.viewsCount ?? 0,
      pendingReports,
      openTickets,
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
    const allowedStatuses = ['pending', 'approved', 'rejected', 'hidden', 'archived'];
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

  // Статусы: pending → approved | rejected; approved → hidden (скрыть из ленты и поиска);
  // hidden | rejected → approved (вернуть). Автору — уведомление о каждом переходе.
  @Patch('ads/:id/status')
  async setAdStatus(
    @Param('id') id: string,
    @Body() body: { status?: string; note?: string }
  ) {
    const allowed = ['pending', 'approved', 'rejected', 'hidden'];
    if (!body?.status || !allowed.includes(body.status)) {
      throw new BadRequestException(`status must be one of ${allowed.join(', ')}`);
    }
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
    const before = await this.prisma.ad.findUnique({
      where: { id },
      select: { status: true, authorId: true, title: true, publishedAt: true }
    });
    if (!before) throw new BadRequestException('Ad not found');
    const { lifetimeDays } = await lifecycleSettings(this.prisma);
    const now = Date.now();
    const ad = await this.prisma.ad.update({
      where: { id },
      data: {
        status: body.status as any,
        moderationNotes: note || null,
        // Дата первой публикации: возврат скрытого не поднимает его как новое.
        publishedAt: body.status === 'approved' && !before.publishedAt ? new Date() : undefined,
        // Сроки: опубликованное живёт lifetimeDays с момента (повторной) публикации,
        // отклонённое ждёт удаления с момента отклонения.
        ...(body.status === 'approved'
          ? { expiresAt: new Date(now + lifetimeDays * DAY_MS), archivedAt: null, rejectedAt: null }
          : {}),
        ...(body.status === 'rejected' ? { rejectedAt: new Date(now) } : {}),
        lifecycleWarnedAt: before.status !== body.status ? null : undefined
      },
      select: { id: true, status: true, moderationNotes: true }
    });

    if (before.status !== body.status) {
      const reason = note ? `Причина: ${note}` : null;
      if (body.status === 'approved') {
        const firstTime = before.status === 'pending';
        await this.notifications.notify(before.authorId, {
          type: 'ad_approved',
          title: firstTime
            ? `Объявление опубликовано: «${before.title}»`
            : `Объявление снова в ленте: «${before.title}»`,
          body: 'Его уже видят в ленте и поиске.',
          link: `/ad/${id}`,
          cta: 'Открыть объявление'
        });
      } else if (body.status === 'rejected') {
        await this.notifications.notify(before.authorId, {
          type: 'ad_rejected',
          title: `Объявление отклонено: «${before.title}»`,
          body: reason || 'Оно не прошло модерацию. Проверьте правила и подайте заново.',
          link: `/ad/${id}`,
          cta: 'Посмотреть'
        });
      } else if (body.status === 'hidden') {
        await this.notifications.notify(before.authorId, {
          type: 'ad_hidden',
          title: `Объявление скрыто модератором: «${before.title}»`,
          body: `${reason ? `${reason}\n` : ''}Его не видно в ленте и поиске. Если это ошибка — напишите в поддержку.`,
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
    if (!target) throw new BadRequestException('Ad not found');
    await purgeAd(this.prisma, this.s3, id);
    const why = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
    await this.notifications.notify(target.authorId, {
      type: 'ad_removed',
      title: `Объявление удалено модератором: «${target.title}»`,
      body: why ? `Причина: ${why}` : 'Оно нарушало правила площадки.',
      link: '/terms',
      cta: 'Правила площадки'
    });
    return { ok: true };
  }

  // ── Настройки ленты и модерации ──────────────────────────────────
  // Только перечисленные ключи; значение проверяется по диапазону. Лента подхватывает
  // новые веса в течение минуты (кеш в AdsService).

  // Диагностика: какой IP сервер видит у админа. Должен совпасть с настоящим
  // адресом — иначе лимиты запросов считаются по адресу прокси, общему для всех.
  @Get('whoami')
  whoami(@Req() req: { ip?: string; ips?: string[]; socket?: { remoteAddress?: string }; headers: Record<string, unknown> }) {
    // Все заголовки, в которых прокси могут передавать адрес клиента, — чтобы понять,
    // откуда брать настоящий IP за прокси Amvera. Только для админа.
    const ipHeaders = Object.fromEntries(
      Object.entries(req.headers).filter(([k]) => /forward|real|client|via|envoy|cf-|true-|ip/i.test(k))
    );
    return {
      ip: req.ip ?? null,
      ips: req.ips ?? [],
      socket: req.socket?.remoteAddress ?? null,
      forwardedFor: req.headers['x-forwarded-for'] ?? null,
      realIp: req.headers['x-real-ip'] ?? null,
      ipHeaders
    };
  }

  @Get('settings')
  async getSettings() {
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: Object.keys(MANAGED_SETTINGS) } }
    });
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    return {
      items: Object.entries(MANAGED_SETTINGS).map(([key, def]) => ({
        key,
        ...def,
        value: byKey.get(key) ?? def.default
      }))
    };
  }

  @Patch('settings')
  async setSetting(@Body() body: { key?: string; value?: string | number | boolean }) {
    const def = body?.key ? MANAGED_SETTINGS[body.key] : undefined;
    if (!def || body.value == null) throw new BadRequestException('Unknown setting');
    let value: string;
    if (def.type === 'bool') {
      value = body.value === true || body.value === 'true' ? 'true' : 'false';
    } else {
      const n = Number(body.value);
      if (!Number.isFinite(n) || n < def.min || n > def.max) {
        throw new BadRequestException(`${def.label}: от ${def.min} до ${def.max}`);
      }
      value = String(n);
    }
    await this.prisma.setting.upsert({
      where: { key: body.key! },
      update: { value },
      create: { key: body.key!, value, description: def.label }
    });
    return { key: body.key, value };
  }

  // ── Поддержка ────────────────────────────────────────────────────

  @Get('support')
  listSupport(@Query('status') status?: string) {
    return this.support.adminList(status);
  }

  @Post('support/:id/reply')
  replySupport(@Param('id') id: string, @Body() body: { text?: string }) {
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > 2000) throw new BadRequestException('Текст ответа: 1–2000 символов');
    return this.support.adminReply(id, text);
  }

  @Patch('support/:id')
  setSupportStatus(@Param('id') id: string, @Body() body: { status?: string }) {
    return this.support.adminSetStatus(id, body?.status || '');
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
