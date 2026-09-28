import { PrismaService } from '../prisma/prisma.service';

// Админ — role admin/owner или email из ADMIN_EMAILS (та же логика, что в AdminGuard).
export async function isAdminUser(prisma: PrismaService, userId?: string | null) {
  if (!userId) return false;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, email: true } });
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'owner') return true;
  const emails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return !!user.email && emails.includes(user.email.toLowerCase());
}

// Все админы — для уведомлений о новых обращениях в поддержку.
export async function adminUserIds(prisma: PrismaService) {
  const emails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { role: { in: ['admin', 'owner'] } },
        ...(emails.length ? [{ email: { in: emails, mode: 'insensitive' as const } }] : [])
      ]
    },
    select: { id: true }
  });
  return users.map((u) => u.id);
}
