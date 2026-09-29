import { PrismaService } from '../prisma/prisma.service';

/**
 * Числовые настройки из таблицы Setting (меняются в админке).
 * defaults — { 'ключ': значение по умолчанию }; нет строки или мусор — берём значение по умолчанию.
 */
export async function readNumberSettings<T extends Record<string, number>>(
  prisma: PrismaService,
  defaults: T
): Promise<T> {
  const rows = await prisma.setting.findMany({ where: { key: { in: Object.keys(defaults) } } });
  const out = { ...defaults };
  for (const r of rows) {
    const n = parseFloat(r.value);
    if (Number.isFinite(n)) (out as Record<string, number>)[r.key] = n;
  }
  return out;
}
