import type { Locale } from '@clutch/shared';
import { currentLocale } from './locale';

/** Имя гостя задаёт сервер: «Игрок a1b2». На другом языке меняется только слово, хвост и аватар те же. */
const GUEST = /^Игрок( [0-9a-f]{4})?$/u;
const WORD: Readonly<Record<Locale, string>> = { ru: 'Игрок', en: 'Player', kk: 'Ойыншы' };

export function displayPlayerName(name: string, locale: Locale = currentLocale()): string {
  const match = GUEST.exec(name.trim());
  return match ? `${WORD[locale]}${match[1] ?? ''}` : name;
}
