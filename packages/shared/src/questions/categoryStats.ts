/**
 * Размеры пулов для описаний категорий. Числа, а не таблицы: веб не должен импортировать таблицы
 * стран, флагов и языков (в них ответы). Сверку с данными держит categoryStats.test.ts —
 * поменялся пул, тест скажет обновить число.
 */
export const CATEGORY_POOL_SIZES = {
  generalTopics: 16,
  countries: 197,
  otherFlags: 132,
  languages: 37,
} as const;
