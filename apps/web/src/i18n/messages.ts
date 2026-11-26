import type { Locale } from '@clutch/shared';
import { currentLocale, useLocale } from './locale';

/**
 * Тексты интерфейса. У каждой папки экранов свой словарь `messages.ts`:
 *
 *   export const m = defineMessages({
 *     ru: { title: 'Партии', rounds: (n: number) => `${n} ${plural('ru', n, ['круг', 'круга', 'кругов'])}` },
 *     en: { … те же ключи … },
 *     kk: { … те же ключи … },
 *   });
 *   const t = useMessages(m);  // в компоненте; вне React - messagesFor(m)
 *   t.title; t.rounds(3);
 *
 * Тип требует в en и kk ровно те же ключи и сигнатуры, что в ru: забытый перевод не соберётся.
 */
export type MessageValue = string | ((...args: never[]) => string);
export type Messages = Record<string, MessageValue>;

export function defineMessages<T extends Messages>(dictionary: { ru: T; en: NoInfer<T>; kk: NoInfer<T> }): Record<Locale, T> {
  return dictionary;
}

export function useMessages<T extends Messages>(dictionary: Record<Locale, T>): T {
  return dictionary[useLocale()];
}

/** Для кода вне компонентов (построение строк шаринга, моделей экранов). */
export function messagesFor<T extends Messages>(dictionary: Record<Locale, T>, locale: Locale = currentLocale()): T {
  return dictionary[locale];
}

/**
 * Форма слова по числу. ru: [один, несколько, много] - «1 круг, 3 круга, 5 кругов»;
 * en: [one, other]; kk: существительное после числа не меняется - одна форма.
 */
export function plural(locale: Locale, count: number, forms: readonly string[]): string {
  if (locale === 'kk') return forms[0];
  if (locale === 'en') return count === 1 ? forms[0] : forms[1] ?? forms[0];
  const tens = Math.abs(count) % 100;
  const ones = Math.abs(count) % 10;
  if (tens >= 11 && tens <= 14) return forms[2] ?? forms[0];
  if (ones === 1) return forms[0];
  if (ones >= 2 && ones <= 4) return forms[1] ?? forms[0];
  return forms[2] ?? forms[0];
}
