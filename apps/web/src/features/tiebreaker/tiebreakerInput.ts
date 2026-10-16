import { TIEBREAKER_MAX_GUESS } from '@clutch/shared';

/**
 * Разбор числа из поля «На глазок». Запятая и точка — десятичный разделитель; пробелы (в том числе
 * неразрывные) — разделители тысяч; суффиксы «тыс», «млн», «млрд», «трлн» и запись «8e24» — для больших чисел.
 * «1,000» — это единица с тремя нулями после запятой, а не тысяча: запятая у нас всегда десятичная.
 */
export type TiebreakerInputError = 'empty' | 'invalid' | 'negative' | 'not_positive' | 'too_big';

export type TiebreakerInputResult =
  | { ok: true; value: number }
  | { ok: false; error: TiebreakerInputError };

const SUFFIX_FACTOR: Record<string, number> = {
  тыс: 1e3,
  тысяч: 1e3,
  млн: 1e6,
  млрд: 1e9,
  трлн: 1e12,
};

// Мантисса: цифры с пробелами внутри и необязательная дробная часть либо только дробная часть.
// Дальше — либо экспонента, либо суффикс (точка после сокращения допустима), но не вместе.
const INPUT_PATTERN = /^(\d[\d\s]*(?:[.,]\d+)?|[.,]\d+)\s*(?:e\s*([+-]?\d{1,4})|(тысяч|тыс|млн|млрд|трлн)\.?)?$/;

export function parseTiebreakerInput(text: string): TiebreakerInputResult {
  const trimmed = text.replace(/[\s  ]+/g, ' ').trim().toLowerCase();
  if (!trimmed) return { ok: false, error: 'empty' };
  if (/^[-−–—]/.test(trimmed)) return { ok: false, error: 'negative' };

  const match = INPUT_PATTERN.exec(trimmed);
  if (!match) return { ok: false, error: 'invalid' };
  const [, mantissaText, exponentText, suffix] = match;

  const mantissa = Number(mantissaText.replace(/\s/g, '').replace(',', '.'));
  if (Number.isNaN(mantissa)) return { ok: false, error: 'invalid' };
  if (!Number.isFinite(mantissa)) return { ok: false, error: 'too_big' };
  let value = mantissa;
  if (exponentText !== undefined) value = Number(`${mantissa}e${exponentText}`);
  else if (suffix) value = mantissa * SUFFIX_FACTOR[suffix];

  if (Number.isNaN(value)) return { ok: false, error: 'invalid' };
  if (value > TIEBREAKER_MAX_GUESS) return { ok: false, error: 'too_big' };
  if (value <= 0) return { ok: false, error: 'not_positive' };
  return { ok: true, value };
}

/** Подсказка под полем; для пустого ввода подсказки нет, кнопка просто неактивна. */
export function tiebreakerInputHint(error: TiebreakerInputError): string | null {
  switch (error) {
    case 'empty': return null;
    case 'negative': return 'Нужно положительное число.';
    case 'not_positive': return 'Число должно быть больше нуля.';
    case 'too_big': return 'Слишком большое число: максимум 10³⁰.';
    case 'invalid': return 'Введи число, например 1 500 или 1,5 млн.';
  }
}
