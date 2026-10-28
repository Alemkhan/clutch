import { describe, expect, it } from 'vitest';
import {
  TIEBREAKER_BUCKET_COUNT, TIEBREAKER_MAX_GUESS, TIEBREAKER_MIN_ANSWERS_FOR_PERCENTILE,
  isBestAnswerOfDay, isValidTiebreakerGuess, parseTiebreakerGuess, resolveTiebreak, tiebreakerBucketIndex,
  tiebreakerDistribution, tiebreakerMultiplier, tiebreakerPercentile, parseTiebreakerExplanation,
} from './tiebreaker';

describe('tiebreakerMultiplier', () => {
  it('is symmetric: half and double are the same miss', () => {
    expect(tiebreakerMultiplier(50, 100)).toBe(2);
    expect(tiebreakerMultiplier(200, 100)).toBe(2);
  });
  it('is 1 for an exact guess', () => {
    expect(tiebreakerMultiplier(8849, 8849)).toBe(1);
  });
  it('rounds to 4 decimals and absorbs float noise', () => {
    expect(tiebreakerMultiplier(1, 3)).toBe(3);
    expect(tiebreakerMultiplier(10, 3)).toBe(3.3333);
    expect(tiebreakerMultiplier(0.1 + 0.2, 0.3)).toBe(1);
  });
  it('rejects invalid input with RangeError', () => {
    for (const bad of [0, -1, NaN, Infinity, TIEBREAKER_MAX_GUESS * 10]) {
      expect(() => tiebreakerMultiplier(bad, 10), String(bad)).toThrow(RangeError);
    }
    for (const bad of [0, -5, NaN, Infinity]) {
      expect(() => tiebreakerMultiplier(10, bad), String(bad)).toThrow(RangeError);
    }
  });
  it('accepts the upper bound', () => {
    expect(tiebreakerMultiplier(TIEBREAKER_MAX_GUESS, TIEBREAKER_MAX_GUESS)).toBe(1);
  });
});

describe('guess validation', () => {
  it('accepts only finite numbers in (0, 1e30]', () => {
    expect(isValidTiebreakerGuess(1e-9)).toBe(true);
    expect(isValidTiebreakerGuess(1e30)).toBe(true);
    for (const bad of [0, -1, NaN, Infinity, 1.0001e30, '5', null, undefined, {}]) {
      expect(isValidTiebreakerGuess(bad), String(bad)).toBe(false);
    }
    expect(parseTiebreakerGuess(42)).toBe(42);
    expect(() => parseTiebreakerGuess('42')).toThrow(RangeError);
  });
});

describe('resolveTiebreak', () => {
  const a = (multiplier: number, questionId = 'q1') => ({ questionId, multiplier });
  it('both answered the same question: lower multiplier wins', () => {
    expect(resolveTiebreak(a(1.4), a(2.8))).toBe('player');
    expect(resolveTiebreak(a(2.8), a(1.4))).toBe('opponent');
  });
  it('equal multipliers stay a tie', () => {
    expect(resolveTiebreak(a(1.5), a(1.5))).toBe('tie');
  });
  it('only one answered: the one who answered wins', () => {
    expect(resolveTiebreak(a(9), null)).toBe('player');
    expect(resolveTiebreak(null, a(9))).toBe('opponent');
  });
  it('nobody answered: tie', () => {
    expect(resolveTiebreak(null, null)).toBe('tie');
  });
  it('different days: tie', () => {
    expect(resolveTiebreak(a(1.1, 'q1'), a(5, 'q2'))).toBe('tie');
  });
});

describe('distribution buckets', () => {
  it('places ratios on half-decade log buckets, clamping extremes', () => {
    expect(tiebreakerBucketIndex(1)).toBe(6);
    expect(tiebreakerBucketIndex(0.99)).toBe(5);
    expect(tiebreakerBucketIndex(10)).toBe(8);
    expect(tiebreakerBucketIndex(1e-9)).toBe(0);
    expect(tiebreakerBucketIndex(1e9)).toBe(TIEBREAKER_BUCKET_COUNT - 1);
    expect(() => tiebreakerBucketIndex(0)).toThrow(RangeError);
    expect(() => tiebreakerBucketIndex(NaN)).toThrow(RangeError);
  });
  it('counts every ratio exactly once', () => {
    const counts = tiebreakerDistribution([1, 1.2, 0.5, 100, 1e9]);
    expect(counts).toHaveLength(TIEBREAKER_BUCKET_COUNT);
    expect(counts.reduce((sum, value) => sum + value, 0)).toBe(5);
    expect(counts[6]).toBe(2);
    expect(tiebreakerDistribution([])).toEqual(new Array(TIEBREAKER_BUCKET_COUNT).fill(0));
  });
});

describe('tiebreakerPercentile', () => {
  it('is null below the threshold', () => {
    const nine = Array.from({ length: TIEBREAKER_MIN_ANSWERS_FOR_PERCENTILE - 1 }, (_, i) => 1 + i);
    expect(tiebreakerPercentile(1, nine)).toBeNull();
  });
  it('counts the share of others with a strictly larger multiplier', () => {
    const ten = Array.from({ length: 10 }, (_, i) => 1 + i);
    expect(tiebreakerPercentile(1, ten)).toBe(100);
    expect(tiebreakerPercentile(10, ten)).toBe(0);
    expect(tiebreakerPercentile(5, ten)).toBe(Math.floor((5 / 9) * 100));
  });
});

describe('isBestAnswerOfDay', () => {
  const ten = Array.from({ length: 10 }, (_, i) => 1 + i);
  it('is true only when the player is strictly closer than everyone else', () => {
    expect(isBestAnswerOfDay(tiebreakerPercentile(1, ten))).toBe(true);
  });
  it('is false for a tie with someone, for any lower rank and below the sample threshold', () => {
    expect(isBestAnswerOfDay(tiebreakerPercentile(1, [1, 1, ...ten.slice(2)]))).toBe(false);
    expect(isBestAnswerOfDay(tiebreakerPercentile(2, ten))).toBe(false);
    expect(isBestAnswerOfDay(tiebreakerPercentile(1, ten.slice(0, 9)))).toBe(false);
    expect(isBestAnswerOfDay(null)).toBe(false);
  });
});

describe('parseTiebreakerExplanation', () => {
  const step = { label: 'Площадь поля', value: 420, unit: 'м²', sourceUrl: 'https://example.org/a', sourceTitle: 'Пример' };
  const valid = () => ({ steps: [{ ...step }], summary: '≈ 1 400 полей × 2 000 деталей' });
  const bad = (mutate: (e: any) => void) => {
    const e: any = valid();
    mutate(e);
    return () => parseTiebreakerExplanation(e);
  };

  it('accepts a valid explanation, with and without asOf, and returns a clean copy', () => {
    expect(parseTiebreakerExplanation(valid())).toEqual(valid());
    const withAsOf = { steps: [{ ...step, asOf: '2025', unit: '' }], summary: 'итог' };
    expect(parseTiebreakerExplanation(withAsOf)).toEqual(withAsOf);
    expect(parseTiebreakerExplanation(withAsOf).steps[0]).not.toBe(withAsOf.steps[0]);
  });

  it('accepts 8 steps and rejects 0 and 9', () => {
    const many = (n: number) => ({ steps: Array.from({ length: n }, () => ({ ...step })), summary: 'x' });
    expect(parseTiebreakerExplanation(many(8)).steps).toHaveLength(8);
    expect(() => parseTiebreakerExplanation(many(0))).toThrow(RangeError);
    expect(() => parseTiebreakerExplanation(many(9))).toThrow(RangeError);
  });

  it('rejects non-objects and a missing or non-array steps', () => {
    for (const input of [null, undefined, 'x', 5, [], { summary: 'x' }, { steps: {}, summary: 'x' }]) {
      expect(() => parseTiebreakerExplanation(input)).toThrow(RangeError);
    }
  });

  it('rejects non-http(s) and malformed URLs', () => {
    for (const url of ['javascript:alert(1)', 'ftp://example.org', 'data:text/html,x', 'example.org', '']) {
      expect(bad((e) => { e.steps[0].sourceUrl = url; })).toThrow(RangeError);
    }
    expect(parseTiebreakerExplanation({ steps: [{ ...step, sourceUrl: 'http://example.org' }], summary: 'x' }).steps).toHaveLength(1);
  });

  it('rejects a non-finite or non-number value', () => {
    for (const value of [Number.NaN, Infinity, -Infinity, '5', null]) {
      expect(bad((e) => { e.steps[0].value = value; })).toThrow(RangeError);
    }
    expect(parseTiebreakerExplanation({ steps: [{ ...step, value: 0 }], summary: 'x' }).steps[0].value).toBe(0);
  });

  it('rejects missing and extra fields', () => {
    for (const key of ['label', 'value', 'unit', 'sourceUrl', 'sourceTitle']) {
      expect(bad((e) => { delete e.steps[0][key]; })).toThrow(RangeError);
    }
    expect(bad((e) => { delete e.summary; })).toThrow(RangeError);
    expect(bad((e) => { e.steps[0].extra = 1; })).toThrow(/unknown field/);
    expect(bad((e) => { e.extra = 1; })).toThrow(/unknown field/);
    expect(bad((e) => { e.steps[0].asOf = 2025; })).toThrow(RangeError);
  });

  it('rejects empty and over-long strings', () => {
    expect(bad((e) => { e.steps[0].label = '  '; })).toThrow(RangeError);
    expect(bad((e) => { e.steps[0].sourceTitle = ''; })).toThrow(RangeError);
    expect(bad((e) => { e.summary = ''; })).toThrow(RangeError);
    expect(bad((e) => { e.steps[0].label = 'я'.repeat(201); })).toThrow(RangeError);
    expect(bad((e) => { e.summary = 'я'.repeat(401); })).toThrow(RangeError);
    expect(bad((e) => { e.steps[0].unit = 'я'.repeat(41); })).toThrow(RangeError);
    const edge = valid();
    edge.steps[0].label = 'я'.repeat(200);
    edge.summary = 'я'.repeat(400);
    expect(() => parseTiebreakerExplanation(edge)).not.toThrow();
  });
});
