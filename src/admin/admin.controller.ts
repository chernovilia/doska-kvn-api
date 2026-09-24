import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Logger,
  Post
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Служебный контроллер для сброса пользовательских данных на MVP.
 *
 * POST /v1/admin/wipe-users — стирает пользователей, объявления, коды, токены,
 * кошельки, favourites и т.п. Справочники (Region/City/Tier/Setting) сохраняются.
 *
 * Требует заголовок X-Admin-Secret = ADMIN_WIPE_SECRET из env.
 * После первого «настоящего» запуска endpoint надо удалить.
 */
@Controller('admin')
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Post('wipe-users')
  async wipeUsers(@Body() body: { secret?: string }) {
    const expected = process.env.ADMIN_WIPE_SECRET;
    if (!expected) {
      throw new BadRequestException(
        'ADMIN_WIPE_SECRET is not configured on the server'
      );
    }
    if (body?.secret !== expected) {
      throw new ForbiddenException('Bad secret');
    }

    this.logger.warn('Wiping all user data...');
    // Порядок важен из-за FK.
    const [
      adPhotos,
      adPromos,
      adViews,
      favorites,
      reports,
      ads,
      walletTx,
      wallets,
      subscriptions,
      payments,
      businessProfiles,
      refreshTokens,
      emailCodes,
      trustedDevices,
      analyticsEvents,
      users
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

    const summary = {
      users: users.count,
      ads: ads.count,
      adPhotos: adPhotos.count,
      adViews: adViews.count,
      favorites: favorites.count,
      reports: reports.count,
      adPromos: adPromos.count,
      wallets: wallets.count,
      walletTx: walletTx.count,
      businessProfiles: businessProfiles.count,
      subscriptions: subscriptions.count,
      payments: payments.count,
      refreshTokens: refreshTokens.count,
      emailCodes: emailCodes.count,
      trustedDevices: trustedDevices.count,
      analyticsEvents: analyticsEvents.count
    };
    this.logger.warn(`Wipe done: ${JSON.stringify(summary)}`);
    return { ok: true, deleted: summary };
  }
}
