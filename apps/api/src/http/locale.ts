import type { Context } from 'hono';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@clutch/shared';

/** Заголовок, в котором клиент сообщает язык игрока (выбран при первом входе или в профиле). */
export const LOCALE_HEADER = 'X-Clutch-Locale';

/** Язык ответа: из заголовка клиента; неизвестный или пустой — русский (язык исходного контента). */
export function requestLocale(c: Context): Locale {
  const value = c.req.header(LOCALE_HEADER)?.trim().toLowerCase();
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
