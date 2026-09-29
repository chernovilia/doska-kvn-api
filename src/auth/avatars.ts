// Аватар пользователя: готовый вариант («preset:cat» — иконка на цветном фоне,
// рисует сайт) или своё фото из нашего хранилища (…/avatars/<uuid>.webp).
// Чужие ссылки не принимаем — это хотлинк и пиксели слежки.
export const AVATAR_PRESETS = [
  'cat', 'dog', 'rabbit', 'bird', 'fish', 'squirrel',
  'turtle', 'snail', 'flower', 'tree', 'sun', 'rocket'
] as const;

export function s3PublicUrlBase(): string | null {
  const bucket = process.env.TIMEWEB_S3_BUCKET;
  if (!bucket) return null;
  const endpoint = process.env.TIMEWEB_S3_ENDPOINT || 'https://s3.timeweb.cloud';
  return process.env.TIMEWEB_S3_PUBLIC_URL || `${endpoint.replace(/\/$/, '')}/${bucket}`;
}

export function isAllowedAvatar(value: string): boolean {
  if (value.startsWith('preset:')) return (AVATAR_PRESETS as readonly string[]).includes(value.slice(7));
  const base = s3PublicUrlBase();
  return !!base && value.startsWith(`${base}/avatars/`) && /^[\w\-./:]+$/.test(value);
}
