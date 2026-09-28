import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Заблокированный пользователь может смотреть сайт, но не публиковать, писать и оценивать.
export async function assertNotBlocked(prisma: PrismaService, userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { blockedAt: true } });
  if (user?.blockedAt) throw new ForbiddenException('Аккаунт заблокирован модератором');
}
