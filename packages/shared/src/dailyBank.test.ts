import { describe, expect, it } from 'vitest';
import {
  DAILY_BANK_SIZE,
  clearDailyBankCache,
  countries,
  dailyBankCacheSize,
  dailyQuestionBank,
  dailyQuestionSet,
  generateCapitalOpenAnswer,
  generateCountryToCapital,
  isAnswerCorrect,
  type CategoryId,
} from './index';

const day = Date.UTC(2026, 9, 8, 12, 0, 0);
const templateOf = (id: string) => id.replace(/_[a-z]{2}$/, '');
const entityOf = (id: string) => id.slice(-2);

describe('daily bank as a whole', () => {
  it('is deterministic and index-addressable', () => {
    clearDailyBankCache();
    const first = Array.from({ length: DAILY_BANK_SIZE }, (_, i) => dailyQuestionSet('geography', day, i));
    clearDailyBankCache();
    const second = Array.from({ length: DAILY_BANK_SIZE }, (_, i) => dailyQuestionSet('geography', day + 5_000, 11 - i));
    expect(second.reverse()).toEqual(first);
  });

  it('does not depend on Math.random', () => {
    clearDailyBankCache();
    const baseline = dailyQuestionBank('geography', day);
    clearDailyBankCache();
    const original = Math.random;
    Math.random = () => 0.5;
    try {
      expect(dailyQuestionBank('geography', day)).toEqual(baseline);
    } finally {
      Math.random = original;
    }
  });

  it('asks a repeated country with different templates until they run out', () => {
    clearDailyBankCache();
    const bank = dailyQuestionBank('geography', day);
    const byEntity = new Map<string, string[]>();
    for (const set of bank) {
      for (const question of set.questions) {
        const list = byEntity.get(entityOf(question.id)) ?? [];
        list.push(templateOf(question.id));
        byEntity.set(entityOf(question.id), list);
      }
    }
    let repeated = 0;
    for (const templates of byEntity.values()) {
      if (templates.length < 2) continue;
      repeated++;
      // Never a duplicate while fewer than 4 uses (the smallest template pool is 3 choice + 2 open = 5 total).
      const firstFour = templates.slice(0, 4);
      expect(new Set(firstFour).size).toBe(firstFour.length);
    }
    expect(repeated).toBeGreaterThan(0);
  });

  it('keeps the entity unique inside one set', () => {
    for (const set of dailyQuestionBank('geography', day)) {
      const ids = set.questions.map((q) => entityOf(q.id));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it.each(['history', 'languages'] as CategoryId[])('builds %s without looping or throwing', (category) => {
    clearDailyBankCache();
    const bank = dailyQuestionBank(category, day);
    expect(bank).toHaveLength(DAILY_BANK_SIZE);
    expect(bank.every((set) => set.questions.length === 10)).toBe(true);
  });

  it('memoizes and bounds the cache', () => {
    clearDailyBankCache();
    expect(dailyQuestionBank('geography', day)).toBe(dailyQuestionBank('geography', day + 1000));
    expect(dailyBankCacheSize()).toBe(1);
    for (let d = 0; d < 40; d++) dailyQuestionBank('languages', Date.UTC(2026, 0, 1 + d));
    expect(dailyBankCacheSize()).toBeLessThanOrEqual(6);
  });

  it('returns copies from dailyQuestionSet so callers cannot corrupt the cache', () => {
    const a = dailyQuestionSet('geography', day, 0);
    a.questions[0].prompt = 'mutated';
    expect(dailyQuestionSet('geography', day, 0).questions[0].prompt).not.toBe('mutated');
  });
});

describe('corrected capitals', () => {
  const find = (code: string) => countries.find((c) => c.code === code)!;

  it('gq is Ciudad de la Paz with source metadata', () => {
    const gq = find('gq');
    expect(gq.capitalRu).toBe('Сьюдад-де-ла-Пас');
    expect(gq.capital).toBe('Ciudad de la Paz');
    expect(gq.sourceUrl).toMatch(/^https:\/\/www\.guineaecuatorialpress\.com\//);
    expect(gq.sourceTitle).toBeTruthy();
    expect(gq.lastVerifiedAt).toBe('2026-10-08');
    const q = generateCapitalOpenAnswer(gq);
    expect(isAnswerCorrect('Сьюдад-де-ла-Пас', q.correctAnswers!).correct).toBe(true);
    expect(isAnswerCorrect('ciudad de la paz', q.correctAnswers!).correct).toBe(true);
    expect(isAnswerCorrect('Малабо', q.correctAnswers!).correct).toBe(false);
  });

  it('bo is Sucre with source metadata', () => {
    const bo = find('bo');
    expect(bo.capitalRu).toBe('Сукре');
    expect(bo.capital).toBe('Sucre');
    expect(bo.sourceUrl).toMatch(/^https:\/\/www\.senapi\.gob\.bo\//);
    expect(bo.lastVerifiedAt).toBe('2026-10-08');
    const q = generateCapitalOpenAnswer(bo);
    expect(isAnswerCorrect('Сукре', q.correctAnswers!).correct).toBe(true);
    expect(isAnswerCorrect('sucre', q.correctAnswers!).correct).toBe(true);
    expect(isAnswerCorrect('Ла-Пас', q.correctAnswers!).correct).toBe(false);
    const mc = generateCountryToCapital(bo);
    expect(mc.options.find((o) => o.id === mc.correctOptionId)?.text).toBe('Сукре');
  });

  it('only gq and bo carry source metadata', () => {
    expect(countries.filter((c) => c.sourceUrl).map((c) => c.code).sort()).toEqual(['bo', 'gq']);
  });
});
