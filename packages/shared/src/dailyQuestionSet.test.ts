import { describe, expect, it } from 'vitest';
import {
  createSeededRandom,
  dailyKey,
  DAILY_BANK_SIZES,
  MAX_DAILY_SET_SIZE,
  dailyBankSize,
  dailyQuestionSet,
  dailySetSize,
  dailyQuestionSetIds,
  generateMatch,
  hashSeed,
  questionSetId,
} from './index';

const day1 = Date.UTC(2026, 9, 7, 12, 0, 0);
const day2 = Date.UTC(2026, 9, 8, 12, 0, 0);

describe('createSeededRandom', () => {
  it('repeats a sequence for the same seed and stays in [0, 1)', () => {
    const a = createSeededRandom(42);
    const b = createSeededRandom(42);
    const values = Array.from({ length: 200 }, () => a());
    expect(values).toEqual(Array.from({ length: 200 }, () => b()));
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it('differs between seeds', () => {
    expect(createSeededRandom(1)()).not.toBe(createSeededRandom(2)());
  });
});

describe('daily keys', () => {
  it('uses the UTC day and builds set ids', () => {
    expect(dailyKey(Date.UTC(2026, 9, 7, 23, 59, 59))).toBe('2026-10-07');
    expect(dailyKey(Date.UTC(2026, 9, 8, 0, 0, 0))).toBe('2026-10-08');
    expect(questionSetId('geography', '2026-10-07', 5)).toBe('geography:2026-10-07:5');
    expect(hashSeed('a')).toBe(hashSeed('a'));
    expect(hashSeed('a')).not.toBe(hashSeed('b'));
  });
});

describe('dailyQuestionSet', () => {
  it.each(['geography', 'history', 'languages'] as const)('is stable within a day for %s', (category) => {
    const first = dailyQuestionSet(category, day1);
    const second = dailyQuestionSet(category, day1 + 3_600_000);
    expect(second).toEqual(first);
    expect(first.questions).toHaveLength(dailySetSize(category));
    expect(first.questionSetId).toBe(`${category}:2026-10-07:0`);
  });

  it('changes on another day and across categories', () => {
    const ids = (set: ReturnType<typeof dailyQuestionSet>) => set.questions.map((q) => q.id);
    expect(ids(dailyQuestionSet('geography', day2))).not.toEqual(ids(dailyQuestionSet('geography', day1)));
    expect(ids(dailyQuestionSet('languages', day1))).not.toEqual(ids(dailyQuestionSet('history', day1)));
  });

  it('is independent of Math.random', () => {
    const original = Math.random;
    const baseline = dailyQuestionSet('geography', day1);
    Math.random = () => 0.123;
    try {
      expect(dailyQuestionSet('geography', day1)).toEqual(baseline);
    } finally {
      Math.random = original;
    }
  });
});

describe('daily bank', () => {
  it('has the configured number of ids, in index order, for the UTC day', () => {
    const ids = dailyQuestionSetIds('geography', day1);
    expect(ids).toHaveLength(dailyBankSize('geography'));
    expect(dailyBankSize('geography')).toBe(12);
    expect(ids[0]).toBe('geography:2026-10-07:0');
    expect(ids[11]).toBe('geography:2026-10-07:11');
    expect(dailyQuestionSetIds('geography', day1 + 3_600_000)).toEqual(ids);
  });

  it('is deterministic per index and different between indexes', () => {
    const questionIds = (index: number) => dailyQuestionSet('history', day1, index).questions.map((q) => q.id);
    const all = Array.from({ length: dailyBankSize('history') }, (_, index) => questionIds(index));
    expect(all.map((_, index) => questionIds(index))).toEqual(all);
    expect(new Set(all.map((ids) => ids.join('|'))).size).toBe(dailyBankSize('history'));
    expect(dailyQuestionSet('history', day1, 5).questionSetId).toBe('history:2026-10-07:5');
  });

  it('rejects an index outside the bank', () => {
    expect(() => dailyQuestionSet('history', day1, dailyBankSize('history'))).toThrow(RangeError);
    expect(() => dailyQuestionSet('history', day1, -1)).toThrow(RangeError);
  });
});

describe('generateMatch rng parameter', () => {
  it('uses the given rng and restores default randomness afterwards', () => {
    const ids = (seed: number) => generateMatch(10, 0.3, 'geography', createSeededRandom(seed)).map((q) => q.id);
    expect(ids(7)).toEqual(ids(7));
    expect(ids(7)).not.toEqual(ids(8));
    const a = generateMatch(10, 0.3, 'geography').map((q) => q.id);
    const b = generateMatch(10, 0.3, 'geography').map((q) => q.id);
    expect(a).not.toEqual(b);
  });
});

describe('dailySetSize', () => {
  it('is per category, bounded by the entity supply', () => {
    expect([dailySetSize('geography'), dailySetSize('history'), dailySetSize('languages')]).toEqual([20, 18, 18]);
    expect(MAX_DAILY_SET_SIZE).toBe(20);
  });
});

describe('dailyBankSize', () => {
  it('is per category: thin categories get fewer, longer sets', () => {
    expect(DAILY_BANK_SIZES).toEqual({ geography: 12, history: 6, languages: 6 });
    expect(dailyQuestionSetIds('languages', day1)).toHaveLength(6);
  });
});
