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

// Юридические тексты (правила, политика конфиденциальности). Нет записи — сайт показывает
// текст по умолчанию из своего кода. Формат — простая разметка, см. components/LegalDoc.jsx на сайте.
export const LEGAL_DOCS = ['terms', 'privacy'] as const;
export type LegalDocName = (typeof LEGAL_DOCS)[number];
export const LEGAL_MAX_LENGTH = 120_000;
export const legalKey = (doc: LegalDocName) => `legal.${doc}`;
export type LegalDoc = { text: string; date: string }; // date — дата редакции, ГГГГ-ММ-ДД

export function isLegalDoc(v: string): v is LegalDocName {
  return (LEGAL_DOCS as readonly string[]).includes(v);
}
