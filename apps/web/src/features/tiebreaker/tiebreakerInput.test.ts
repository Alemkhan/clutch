import { describe, expect, it } from 'vitest';
import { parseTiebreakerInput, tiebreakerInputHint } from './tiebreakerInput';

const ok = (value: number) => ({ ok: true, value });
const fail = (error: string) => ({ ok: false, error });

describe('parseTiebreakerInput', () => {
  it('reads plain numbers with a comma or a dot as the decimal separator', () => {
    expect(parseTiebreakerInput('1500')).toEqual(ok(1500));
    expect(parseTiebreakerInput('1,5')).toEqual(ok(1.5));
    expect(parseTiebreakerInput('1.5')).toEqual(ok(1.5));
    expect(parseTiebreakerInput(',5')).toEqual(ok(0.5));
    // Запятая всегда десятичная: «1,000» — единица, а не тысяча.
    expect(parseTiebreakerInput('1,000')).toEqual(ok(1));
  });

  it('accepts spaces, including non-breaking ones, as thousand separators', () => {
    expect(parseTiebreakerInput('1 500 000')).toEqual(ok(1_500_000));
    expect(parseTiebreakerInput('1 500 000,5')).toEqual(ok(1_500_000.5));
    expect(parseTiebreakerInput('  42  ')).toEqual(ok(42));
  });

  it('understands the suffixes for big numbers', () => {
    expect(parseTiebreakerInput('1,5 млн')).toEqual(ok(1_500_000));
    expect(parseTiebreakerInput('2 тыс')).toEqual(ok(2000));
    expect(parseTiebreakerInput('2 тыс.')).toEqual(ok(2000));
    expect(parseTiebreakerInput('3млрд')).toEqual(ok(3e9));
    expect(parseTiebreakerInput('7 МЛРД')).toEqual(ok(7e9));
    expect(parseTiebreakerInput('1 000 тыс')).toEqual(ok(1_000_000));
  });

  it('understands exponent notation', () => {
    expect(parseTiebreakerInput('8e24')).toEqual(ok(8e24));
    expect(parseTiebreakerInput('1,5e3')).toEqual(ok(1500));
    expect(parseTiebreakerInput('2E-3')).toEqual(ok(0.002));
  });

  it('rejects garbage', () => {
    for (const text of ['abc', '1,2,3', '1..5', '12 abc', '1 млн млн', '1e', 'e5', '5 тыс 3', '∞', 'NaN', 'Infinity', '1,5e3 млн', '0x10', '--1']) {
      expect(parseTiebreakerInput(text), text).toMatchObject({ ok: false });
    }
    expect(parseTiebreakerInput('')).toEqual(fail('empty'));
    expect(parseTiebreakerInput('   ')).toEqual(fail('empty'));
    expect(parseTiebreakerInput('abc')).toEqual(fail('invalid'));
  });

  it('rejects zero and negatives', () => {
    expect(parseTiebreakerInput('0')).toEqual(fail('not_positive'));
    expect(parseTiebreakerInput('0,0')).toEqual(fail('not_positive'));
    expect(parseTiebreakerInput('0 млн')).toEqual(fail('not_positive'));
    expect(parseTiebreakerInput('1e-999')).toEqual(fail('not_positive'));
    expect(parseTiebreakerInput('-5')).toEqual(fail('negative'));
    expect(parseTiebreakerInput('−5')).toEqual(fail('negative'));
  });

  it('rejects numbers above 1e30 and accepts 1e30 itself', () => {
    expect(parseTiebreakerInput('1e30')).toEqual(ok(1e30));
    expect(parseTiebreakerInput('1e31')).toEqual(fail('too_big'));
    expect(parseTiebreakerInput('1e999')).toEqual(fail('too_big'));
    expect(parseTiebreakerInput('9'.repeat(400))).toEqual(fail('too_big'));
  });

  it('has a hint for every error except the empty field', () => {
    expect(tiebreakerInputHint('empty')).toBeNull();
    for (const error of ['invalid', 'negative', 'not_positive', 'too_big'] as const) {
      expect(tiebreakerInputHint(error)).toEqual(expect.any(String));
    }
  });
});
