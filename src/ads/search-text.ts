// Поиск без учёта регистра, не зависящий от локали БД.
// На проде Postgres с локалью C: ILIKE и lower() там складывают только латиницу,
// и «лада» не находила «Лада». Поэтому держим у объявления готовую строку в нижнем
// регистре (JS складывает кириллицу правильно) и ищем по ней обычным contains.

export function normalizeSearch(s: string) {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

export function buildSearchText(ad: {
  title: string;
  description?: string | null;
  address?: string | null;
  categoryGroup?: string | null;
  category?: string | null;
  attributes?: unknown;
}) {
  const attrs =
    ad.attributes && typeof ad.attributes === 'object' && !Array.isArray(ad.attributes)
      ? Object.values(ad.attributes as Record<string, unknown>).map(String)
      : [];
  return normalizeSearch(
    [ad.title, ad.description, ad.address, ad.categoryGroup, ad.category, ...attrs].filter(Boolean).join(' ')
  ).slice(0, 8000);
}
