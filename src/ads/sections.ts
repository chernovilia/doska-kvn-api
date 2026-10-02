// Разделы объявлений. Должны совпадать с data/categories.js на фронте.
export const SECTION_IDS = [
  'auto',
  'realty',
  'jobs',
  'services',
  'electronics',
  'home',
  'clothes',
  'kids',
  'pets',
  'hobby',
  'food',
  'business',
  'lost',
  'events'
] as const;

// «Отдам даром» — не раздел, а фильтр ленты: цена 0 в разделах с вещами и животными.
export const FREE_SECTION = 'free';
export const FREE_FROM_SECTIONS = ['electronics', 'home', 'clothes', 'kids', 'pets', 'hobby', 'auto'];
