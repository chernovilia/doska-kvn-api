import { PrismaService } from '../prisma/prisma.service';

// Настройки-структуры (JSON в Setting.value): соседние города, контакты сайта.
export const NEIGHBORS_KEY = 'places.neighbors'; // { cityId: [cityId, …] }
export const CONTACTS_KEY = 'site.contacts'; // { email, phone, telegram, vk }

export const APP_TEXTS_KEY = 'app.texts'; // тексты окна установки
// Поле → максимальная длина
export const APP_TEXT_FIELDS: Record<string, number> = {
  title: 60,
  subtitle: 100,
  benefit1Title: 40,
  benefit1Text: 120,
  benefit2Title: 40,
  benefit2Text: 120
};

export const CONTACT_FIELDS = ['email', 'phone', 'telegram', 'vk'] as const;
export type SiteContacts = Partial<Record<(typeof CONTACT_FIELDS)[number], string>>;

export async function readJsonSetting<T>(prisma: PrismaService, key: string, fallback: T): Promise<T> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonSetting(prisma: PrismaService, key: string, value: unknown, description: string) {
  const json = JSON.stringify(value);
  await prisma.setting.upsert({ where: { key }, update: { value: json }, create: { key, value: json, description } });
}
