import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { AdStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { S3ClientService } from '../uploads/s3.client';
import { NotificationsService } from '../notifications/notifications.service';
import { DAY_MS, lifecycleSettings, purgeAd } from './lifecycle';
import { readNumberSettings } from '../settings/read-settings';

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
  private lastOrphanSweep = 0;

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
      const stats = { ...(await this.step()), autoBumped: await this.autoBump() };
      if (Object.values(stats).some((n) => n > 0)) this.logger.log(JSON.stringify(stats));
      // Раз в сутки — потерянные фото (загрузили и закрыли форму, сменили аватар).
      if (Date.now() - this.lastOrphanSweep > 23 * 3_600_000) {
        this.lastOrphanSweep = Date.now();
        const removed = await this.sweepOrphanPhotos();
        if (removed) this.logger.log(`Удалено потерянных фото: ${removed}`);
      }
    } catch (err) {
      this.logger.error(`Прогон не удался: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Автоподнятие: у опубликованных объявлений с включённым autoBump, у которых наступил срок
   * подъёма (ranking.bump_cooldown_days после публикации или прошлого подъёма), ставим boostedAt.
   * Выключено в админке (ranking.auto_bump_enabled) — никого не поднимаем.
   */
  async autoBump(): Promise<number> {
    const enabled = await this.prisma.setting.findUnique({ where: { key: 'ranking.auto_bump_enabled' } });
    if ((enabled?.value ?? 'true') !== 'true') return 0;
    const s = await readNumberSettings(this.prisma, { 'ranking.bump_cooldown_days': 10 });
    const now = new Date();
    const cutoff = new Date(now.getTime() - s['ranking.bump_cooldown_days'] * DAY_MS);
    const { count } = await this.prisma.ad.updateMany({
      where: {
        status: AdStatus.approved,
        autoBump: true,
        publishedAt: { lte: cutoff },
        OR: [{ boostedAt: null }, { boostedAt: { lte: cutoff } }]
      },
      data: { boostedAt: now }
    });
    return count;
  }

  /**
   * Фото в хранилище, на которые не ссылается ни одно объявление и ни один аватар, старше суток:
   * загрузили в форму и закрыли вкладку, убрали фото, сменили аватар. Сутки — запас на то,
   * чтобы не удалить фото из формы, которую человек ещё заполняет.
   */
  async sweepOrphanPhotos(): Promise<number> {
    if (!this.s3.configured) return 0;
    const cutoff = Date.now() - DAY_MS;
    const objects = [...(await this.s3.listObjects('ads/')), ...(await this.s3.listObjects('avatars/'))].filter(
      (o) => o.lastModified.getTime() < cutoff
    );
    if (!objects.length) return 0;
    const [photos, avatars] = await Promise.all([
      this.prisma.adPhoto.findMany({ select: { url: true } }),
      this.prisma.user.findMany({ where: { avatar: { startsWith: 'http' } }, select: { avatar: true } })
    ]);
    // Ключ — по сегменту ads/… или avatars/…, а не по текущему адресу хранилища:
    // если адрес когда-то менялся, у старых фото другой префикс, но тот же ключ.
    const keyOf = (url: string) => url.match(/(?:^|\/)((?:ads|avatars)\/.+)$/)?.[1] ?? null;
    const used = new Set<string>();
    for (const p of photos) {
      const key = keyOf(p.url);
      if (!key) continue;
      used.add(key);
      used.add(key.replace(/\.webp$/, '-t.webp')); // миниатюра
    }
    for (const u of avatars) {
      const key = u.avatar && keyOf(u.avatar);
      if (key) used.add(key);
    }
    // Страховка: фото в базе есть, а ни одно не нашлось в хранилище — что-то не так с ключами, не трогаем.
    const matched = objects.filter((o) => used.has(o.key)).length;
    if (photos.length > 0 && matched === 0) {
      this.logger.warn('Чистка фото пропущена: ни одно фото из базы не найдено в хранилище');
      return 0;
    }
    const orphans = objects.filter((o) => !used.has(o.key)).map((o) => this.s3.urlFromKey(o.key));
    // deleteByUrls сам добавит миниатюры; их отдельные ключи в списке тоже, дубли S3 не мешают.
    await this.s3.deleteByUrls(orphans);
    return orphans.length;
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
