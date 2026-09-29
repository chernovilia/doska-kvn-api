// Поля объявления, которые не уходят наружу в ленте и на странице:
// phone — телефон отдаёт только /ads/:id/contact (вошедшим, по правилам продавца);
// searchText — служебная строка поиска; остальное — внутренняя модерация и учёт.
const PRIVATE_FIELDS = ['phone', 'searchText', 'reportsCount', 'authorSnapshot', 'moderationLevel'] as const;

export function publicAd<T extends Record<string, any>>(ad: T): Omit<T, (typeof PRIVATE_FIELDS)[number]> {
  const out: Record<string, any> = { ...ad };
  for (const key of PRIVATE_FIELDS) delete out[key];
  return out as Omit<T, (typeof PRIVATE_FIELDS)[number]>;
}
