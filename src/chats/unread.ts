import { PrismaService } from '../prisma/prisma.service';

// Непрочитанные сообщения пользователя во всех диалогах — для значка в меню и счётчика на иконке приложения.
export async function countUnreadMessages(prisma: PrismaService, userId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM "Message" m
    JOIN "Conversation" c ON c.id = m."conversationId"
    WHERE m."senderId" <> ${userId}
      AND (
        (c."buyerId" = ${userId} AND (c."buyerLastReadAt" IS NULL OR m."createdAt" > c."buyerLastReadAt"))
        OR
        (c."sellerId" = ${userId} AND (c."sellerLastReadAt" IS NULL OR m."createdAt" > c."sellerLastReadAt"))
      )`;
  return rows[0]?.count ?? 0;
}
