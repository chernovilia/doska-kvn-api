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
  UseGuards
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdminGuard } from './admin.guard';

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
  constructor(private readonly prisma: PrismaService) {}

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
    const [
      users,
      ads,
      approvedAds,
      pendingAds,
      adPhotos,
      businessProfiles,
      wallets,
      refreshTokens,
      emailCodes,
      subscriptions,
      payments
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.ad.count(),
      this.prisma.ad.count({ where: { status: 'approved' } }),
      this.prisma.ad.count({ where: { status: 'pending' } }),
      this.prisma.adPhoto.count(),
      this.prisma.businessProfile.count(),
      this.prisma.wallet.count(),
      this.prisma.refreshToken.count(),
      this.prisma.emailCode.count(),
      this.prisma.subscription.count(),
      this.prisma.payment.count()
    ]);
    return {
      users,
      ads,
      approvedAds,
      pendingAds,
      adPhotos,
      businessProfiles,
      wallets,
      refreshTokens,
      emailCodes,
      subscriptions,
      payments
    };
  }

  @Get('users')
  async users(
    @Query('limit') limit = '100',
    @Query('offset') offset = '0'
  ) {
    const take = Math.min(500, Math.max(1, Number(limit) || 100));
    const skip = Math.max(0, Number(offset) || 0);
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        select: {
          id: true,
          email: true,
          phone: true,
          name: true,
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
          rating: true,
          reviewsCount: true,
          dealsCount: true
        }
      }),
      this.prisma.user.count()
    ]);
    return { items, total };
  }

  @Get('ads')
  async ads(
    @Query('limit') limit = '100',
    @Query('offset') offset = '0',
    @Query('status') status?: string
  ) {
    const take = Math.min(500, Math.max(1, Number(limit) || 100));
    const skip = Math.max(0, Number(offset) || 0);
    const allowedStatuses = ['pending', 'approved', 'rejected', 'archived'];
    const where = status && allowedStatuses.includes(status)
      ? { status: status as any }
      : {};
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
          category: true,
          price: true,
          status: true,
          cityId: true,
          regionId: true,
          authorId: true,
          authorType: true,
          createdAt: true,
          author: {
            select: { id: true, email: true, name: true }
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
    @Body() body: { status?: string }
  ) {
    const allowed = ['pending', 'approved', 'rejected', 'archived'];
    if (!body?.status || !allowed.includes(body.status)) {
      throw new BadRequestException(`status must be one of ${allowed.join(', ')}`);
    }
    const ad = await this.prisma.ad.update({
      where: { id },
      data: { status: body.status as any },
      select: { id: true, status: true }
    });
    return ad;
  }

  @Delete('ads/:id')
  async deleteAd(@Param('id') id: string) {
    await this.prisma.$transaction([
      this.prisma.adPhoto.deleteMany({ where: { adId: id } }),
      this.prisma.adView.deleteMany({ where: { adId: id } }),
      this.prisma.adPromo.deleteMany({ where: { adId: id } }),
      this.prisma.favorite.deleteMany({ where: { adId: id } }),
      this.prisma.report.deleteMany({ where: { targetKind: 'ad', targetId: id } }),
      this.prisma.ad.delete({ where: { id } })
    ]);
    return { ok: true };
  }

  @Delete('users/:id')
  async deleteUser(@Param('id') id: string) {
    await this.prisma.$transaction([
      this.prisma.adPhoto.deleteMany({ where: { ad: { authorId: id } } }),
      this.prisma.adView.deleteMany({ where: { ad: { authorId: id } } }),
      this.prisma.adPromo.deleteMany({ where: { ad: { authorId: id } } }),
      this.prisma.favorite.deleteMany({ where: { ad: { authorId: id } } }),
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
    return { ok: true };
  }

  @Post('wipe')
  async wipe(@Query('confirm') confirm?: string) {
    if (confirm !== 'WIPE_ALL') {
      throw new BadRequestException('Pass ?confirm=WIPE_ALL to proceed');
    }
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
