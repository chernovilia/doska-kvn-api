import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

// Короткая ссылка на объявление: /ad/<первые 8 символов id> вместо полного UUID.
// Полные ссылки тоже работают. База не меняется: ищем по началу id.
export const SHORT_ID_RE = /^[0-9a-f]{8}$/;

export function shortAdId(id: string): string {
  return id.length === 36 ? id.slice(0, 8) : id;
}

// Ссылка для уведомлений и писем.
export function adLink(id: string): string {
  return `/ad/${shortAdId(id)}`;
}

// Полный id по тому, что пришло в адресе: полный id или короткий (8 символов).
export async function resolveAdId(prisma: PrismaService, idOrShort: string): Promise<string | null> {
  const short = idOrShort.toLowerCase();
  if (!SHORT_ID_RE.test(short)) return idOrShort;
  const exact = await prisma.ad.findUnique({ where: { id: idOrShort }, select: { id: true } });
  if (exact) return exact.id;
  const byPrefix = await prisma.ad.findFirst({
    where: { id: { startsWith: `${short}-` } },
    orderBy: { createdAt: 'asc' },
    select: { id: true }
  });
  return byPrefix?.id ?? null;
}

// Новый id, у которого короткая часть ещё не занята: короткая ссылка всегда ведёт на одно объявление.
export async function newAdId(prisma: PrismaService): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const id = randomUUID();
    const taken = await prisma.ad.findFirst({ where: { id: { startsWith: `${id.slice(0, 8)}-` } }, select: { id: true } });
    if (!taken) return id;
  }
  return randomUUID();
}
