import { PrismaService } from '../prisma/prisma.service';
import { S3ClientService } from '../uploads/s3.client';
import { readNumberSettings } from '../settings/read-settings';

export const DAY_MS = 86_400_000;

// Сроки жизни объявления — из админки (Setting), по умолчанию 60 / 90 / 30 дней и предупреждение за 3.
export async function lifecycleSettings(prisma: PrismaService) {
  const s = await readNumberSettings(prisma, {
    'ads.lifetime_days': 60,
    'ads.archive_keep_days': 90,
    'ads.rejected_keep_days': 30,
    'ads.lifecycle_warn_days': 3
  });
  return {
    lifetimeDays: Math.max(1, Math.round(s['ads.lifetime_days'])),
    archiveKeepDays: Math.max(1, Math.round(s['ads.archive_keep_days'])),
    rejectedKeepDays: Math.max(1, Math.round(s['ads.rejected_keep_days'])),
    warnDays: Math.max(0, Math.round(s['ads.lifecycle_warn_days']))
  };
}

export type LifecycleSettings = Awaited<ReturnType<typeof lifecycleSettings>>;

// Для автора и админа: когда объявление удалим и можно ли его продлить сейчас.
export function lifecycleInfo(
  ad: { status: string; expiresAt?: Date | null; archivedAt?: Date | null; rejectedAt?: Date | null },
  cfg: LifecycleSettings
) {
  const t = (d?: Date | null) => (d ? new Date(d).getTime() : null);
  const deleteAt =
    ad.status === 'archived' && ad.archivedAt
      ? new Date(t(ad.archivedAt)! + cfg.archiveKeepDays * DAY_MS)
      : ad.status === 'rejected' && ad.rejectedAt
        ? new Date(t(ad.rejectedAt)! + cfg.rejectedKeepDays * DAY_MS)
        : null;
  const canRenew =
    ad.status === 'archived' ||
    (ad.status === 'approved' && !!ad.expiresAt && t(ad.expiresAt)! - Date.now() <= cfg.warnDays * DAY_MS);
  return { deleteAt, canRenew };
}

// Удаляет объявление целиком: фото (и миниатюры в S3), просмотры, избранное, жалобы.
export async function purgeAd(prisma: PrismaService, s3: S3ClientService, adId: string) {
  const photos = await prisma.adPhoto.findMany({ where: { adId }, select: { url: true } });
  await prisma.$transaction([
    prisma.adPhoto.deleteMany({ where: { adId } }),
    prisma.adView.deleteMany({ where: { adId } }),
    prisma.adPromo.deleteMany({ where: { adId } }),
    prisma.favorite.deleteMany({ where: { adId } }),
    prisma.report.deleteMany({ where: { targetKind: 'ad', targetId: adId } }),
    prisma.ad.delete({ where: { id: adId } })
  ]);
  void s3.deleteByUrls(photos.map((p) => p.url));
}
