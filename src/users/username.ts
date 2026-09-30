// Свой адрес страницы: /u/<username>. Латиница, цифры и «_», 3–30 символов, начинается с буквы.
export const USERNAME_RE = /^[a-z][a-z0-9_]{2,29}$/;

// Слова, которые нельзя занять: разделы сайта, служебные и вводящие в заблуждение.
const RESERVED = new Set([
  'admin', 'administrator', 'moderator', 'support', 'help', 'api', 'app', 'root', 'system', 'official',
  'doska', 'doskakvn', 'doska_kvn', 'kvn', 'profile', 'user', 'users', 'login', 'logout', 'signup',
  'messages', 'favorites', 'promote', 'terms', 'privacy', 'settings', 'onboarding', 'sitemap', 'robots',
  'ad', 'ads', 'new', 'edit', 'null', 'undefined', 'me', 'www', 'mail', 'info', 'team', 'kulebaki',
  'vyksa', 'navashino', 'murom', 'arzamas', 'pavlovo', 'sarov'
]);

export function normalizeUsername(raw: string) {
  return raw.trim().toLowerCase().replace(/^@/, '');
}

// null — адрес подходит; иначе — почему нет.
export function usernameProblem(u: string): string | null {
  if (!USERNAME_RE.test(u)) return 'Латинские буквы, цифры и «_», от 3 до 30 символов, первая — буква';
  if (RESERVED.has(u)) return 'Этот адрес зарезервирован';
  return null;
}
