import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { AdStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { S3ClientService } from '../uploads/s3.client';
import { NotificationsService } from '../notifications/notifications.service';
import { DAY_MS, lifecycleSettings, purgeAd } from './lifecycle';

const RUN_EVERY_MS = 60 * 60_000;
const BATCH = 200;

function formatDay(d: Date) {
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' });
}

/**
 * Жизненный цикл объявлений, раз в час:
 * опубликованное живёт ads.lifetime_days → за warn_days письмо «продлите» → архив;
 * архив хранится ads.archive_keep_days, отклонённое — ads.rejected_keep_days, потом удаляем
 * (тоже с предупреждением за warn_days). Скрытые модератором не трогаем — решает админ.
 */
@Injectable()
export class AdLifecycleService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('AdLifecycle');
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3ClientService,
    private readonly notifications: NotificationsService
  ) {}

  onApplicationBootstrap() {
    if (process.env.AD_LIFECYCLE === 'off') return;
    // Первый прогон — через минуту после старта, чтобы не мешать запуску.
    this.timers.push(setTimeout(() => void this.run(), 60_000), setInterval(() => void this.run(), RUN_EVERY_MS));
    for (const t of this.timers) t.unref();
  }

  onModuleDestroy() {
    for (const t of this.timers) clearTimeout(t);
  }

  async run() {
    if (this.running) return;
    this.running = true;
    try {
      const stats = await this.step();
      if (Object.values(stats).some((n) => n > 0)) this.logger.log(JSON.stringify(stats));
    } catch (err) {
      this.logger.error(`Прогон не удался: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async step() {
    const cfg = await lifecycleSettings(this.prisma);
    const now = new Date();
    const warnMs = cfg.warnDays * DAY_MS;

    // Объявлениям до появления сроков — срок от публикации, но не раньше чем через неделю.
    // Считаем в коде, а не в SQL: колонки без часового пояса, now() в БД зависит от пояса сессии.
    const noExpiry = await this.prisma.ad.findMany({
      where: { status: AdStatus.approved, expiresAt: null },
      select: { id: true, publishedAt: true, createdAt: true },
      take: 5000
    });
    for (const ad of noExpiry) {
      const from = (ad.publishedAt ?? ad.createdAt).getTime();
      const expiresAt = new Date(Math.max(from + cfg.lifetimeDays * DAY_MS, now.getTime() + 7 * DAY_MS));
      await this.prisma.ad.update({ where: { id: ad.id }, data: { expiresAt } });
    }
    await this.prisma.ad.updateMany({ where: { status: AdStatus.rejected, rejectedAt: null }, data: { rejectedAt: now } });
    await this.prisma.ad.updateMany({ where: { status: AdStatus.archived, archivedAt: null }, data: { archivedAt: now } });

    // 1. Скоро в архив — предупреждаем.
    const expiring = await this.prisma.ad.findMany({
      where: {
        status: AdStatus.approved,
        lifecycleWarnedAt: null,
        expiresAt: { gt: now, lte: new Date(now.getTime() + warnMs) }
      },
      select: { id: true, title: true, authorId: true, expiresAt: true },
      take: BATCH
    });
    for (const ad of expiring) {
      await this.prisma.ad.update({ where: { id: ad.id }, data: { lifecycleWarnedAt: now } });
      await this.notifications.notify(ad.authorId, {
        type: 'ad_expiring',
        title: `Скоро уйдёт в архив: «${ad.title}»`,
        body: `Объявление показывается до ${formatDay(ad.expiresAt!)}. Если оно ещё актуально — продлите, это бесплатно.`,
        link: `/ad/${ad.id}`,
        cta: 'Продлить'
      });
    }

    // 2. Срок вышел — в архив.
    const expired = await this.prisma.ad.findMany({
      where: { status: AdStatus.approved, expiresAt: { lte: now } },
      select: { id: true, title: true, authorId: true },
      take: BATCH
    });
    for (const ad of expired) {
      const { count } = await this.prisma.ad.updateMany({
        where: { id: ad.id, status: AdStatus.approved },
        data: { status: AdStatus.archived, archivedAt: now, lifecycleWarnedAt: null }
      });
      if (!count) continue;
      await this.notifications.notify(ad.authorId, {
        type: 'ad_archived',
        title: `Объявление в архиве: «${ad.title}»`,
        body: `Срок показа закончился. Вернуть его в ленту можно одной кнопкой в течение ${cfg.archiveKeepDays} дней, потом удалим.`,
        link: `/ad/${ad.id}`,
        cta: 'Вернуть в ленту'
      });
    }

    // 3. Архив и отклонённые: предупредить перед удалением, потом удалить.
    const archiveCut = (days: number) => new Date(now.getTime() - days * DAY_MS);
    const soonToDelete = await this.prisma.ad.findMany({
      where: {
        lifecycleWarnedAt: null,
        OR: [
          { status: AdStatus.archived, archivedAt: { lte: archiveCut(cfg.archiveKeepDays - cfg.warnDays), gt: archiveCut(cfg.archiveKeepDays) } },
          { status: AdStatus.rejected, rejectedAt: { lte: archiveCut(cfg.rejectedKeepDays - cfg.warnDays), gt: archiveCut(cfg.rejectedKeepDays) } }
        ]
      },
      select: { id: true, title: true, authorId: true, status: true },
      take: BATCH
    });
    for (const ad of soonToDelete) {
      await this.prisma.ad.update({ where: { id: ad.id }, data: { lifecycleWarnedAt: now } });
      const archived = ad.status === AdStatus.archived;
      await this.notifications.notify(ad.authorId, {
        type: 'ad_deleting',
        title: `Скоро удалим: «${ad.title}»`,
        body: archived
          ? `Объявление в архиве давно. Через ${cfg.warnDays} дн. удалим его вместе с фото — верните в ленту, если ещё актуально.`
          : `Отклонённое объявление удалим через ${cfg.warnDays} дн. вместе с фото. Исправьте и подайте заново, если нужно.`,
        link: `/ad/${ad.id}`,
        cta: archived ? 'Вернуть в ленту' : 'Посмотреть'
      });
    }

    const toDelete = await this.prisma.ad.findMany({
      where: {
        OR: [
          { status: AdStatus.archived, archivedAt: { lte: archiveCut(cfg.archiveKeepDays) } },
          { status: AdStatus.rejected, rejectedAt: { lte: archiveCut(cfg.rejectedKeepDays) } }
        ]
      },
      select: { id: true },
      take: BATCH
    });
    for (const ad of toDelete) await purgeAd(this.prisma, this.s3, ad.id);

    return {
      backfilled: noExpiry.length,
      warned: expiring.length,
      archived: expired.length,
      warnedDelete: soonToDelete.length,
      deleted: toDelete.length
    };
  }
}
