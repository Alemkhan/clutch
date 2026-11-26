/**
 * Язык игрока и гео-зона. Язык выбирает игрок (первый вход, профиль); зона по умолчанию берётся
 * из страны подключения и меняется в профиле. Они независимы: англоязычный игрок в Казахстане
 * получает казахстанский пул на английском.
 */
export const LOCALES = ['ru', 'en', 'kk'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'ru';

export const LOCALE_NAMES: Readonly<Record<Locale, string>> = {
  ru: 'Русский',
  en: 'English',
  kk: 'Қазақша',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Язык из кода Telegram/браузера (`kk`, `ru-RU`, `en-US`…): казахский, русский для СНГ, иначе английский. */
export function localeFromLanguageCode(code: string | null | undefined): Locale {
  const base = (code ?? '').toLowerCase().split(/[-_]/)[0];
  if (base === 'kk' || base === 'kz') return 'kk';
  if (['ru', 'uk', 'be', 'uz', 'ky', 'tg', 'hy', 'az', 'ka', 'tk'].includes(base)) return 'ru';
  return base ? 'en' : DEFAULT_LOCALE;
}

export const REGIONS = ['kz', 'cis', 'world'] as const;
export type Region = (typeof REGIONS)[number];

export function isRegion(value: unknown): value is Region {
  return typeof value === 'string' && (REGIONS as readonly string[]).includes(value);
}

/** Постсоветские страны, кроме Казахстана (ISO 3166-1 alpha-2). */
const CIS_COUNTRIES = new Set(['RU', 'BY', 'UZ', 'KG', 'TJ', 'TM', 'AZ', 'AM', 'GE', 'MD', 'UA']);

/** Зона по стране подключения (Cloudflare `request.cf.country`). Неизвестная страна - мир. */
export function regionFromCountry(country: string | null | undefined): Region {
  const code = (country ?? '').toUpperCase();
  if (code === 'KZ') return 'kz';
  if (CIS_COUNTRIES.has(code)) return 'cis';
  return 'world';
}

/** Вопрос доступен везде: только такие идут в общий набор дня и общую таблицу. */
export function isEverywhere(regions: readonly Region[]): boolean {
  return REGIONS.every((region) => regions.includes(region));
}

/** Настройки игрока на сервере: язык сообщений бота и гео-зона пула. */
export interface PlayerSettingsResponse {
  locale: Locale;
  region: Region;
  /** 'auto' - зона по стране подключения, 'manual' - выбрана в профиле. */
  regionSource: 'auto' | 'manual';
  /** Зона по текущей стране подключения: подсказка в профиле. */
  detectedRegion: Region;
}
