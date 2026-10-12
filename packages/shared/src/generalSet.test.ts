import { describe, expect, it } from 'vitest';
import { clearDailyBankCache, dailyBankSize, dailyQuestionBank, dailyQuestionSet } from './dailyQuestionSet';
import { buildGeneralSet, livePackRecords } from './generalSet';
import { generalPackQuestions } from './generalPack';
import { generateMatch } from './questionGenerator';

const DAY = Date.UTC(2026, 9, 12);

describe('general daily set', () => {
  it('is deterministic for a set id', () => {
    clearDailyBankCache();
    const a = dailyQuestionSet('general', DAY, 3);
    const b = buildGeneralSet(a.questionSetId, '2026-10-12');
    expect(a.questionSetId).toBe('general:2026-10-12:3');
    expect(buildGeneralSet(a.questionSetId, '2026-10-12')).toEqual(b);
    expect(a.questions.map((q) => q.id)).toEqual(b.map((q) => q.id));
    expect(dailyQuestionSet('general', DAY, 3)).toEqual(a);
  });

  it('has 20 questions: 14 from the pack (4 typed) and 6 from generators', () => {
    const { questions } = dailyQuestionSet('general', DAY, 0);
    expect(questions).toHaveLength(20);
    const pack = questions.filter((q) => q.id.startsWith('gp:'));
    expect(pack).toHaveLength(14);
    expect(questions.length - pack.length).toBe(6);
    expect(pack.filter((q) => q.answerType === 'open_answer')).toHaveLength(4);
    expect(new Set(questions.map((q) => q.id)).size).toBe(20);
  });

  it('builds a 12-set bank where pack records do not repeat within the day', () => {
    clearDailyBankCache();
    const bank = dailyQuestionBank('general', DAY);
    expect(bank).toHaveLength(dailyBankSize('general'));
    const ids = bank.flatMap((s) => s.questions.filter((q) => q.id.startsWith('gp:')).map((q) => q.id.split(':')[1]));
    expect(ids).toHaveLength(12 * 14);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('wraps around when approved records run short, without throwing', () => {
    const pool = livePackRecords().slice(0, 20);
    const sets = Array.from({ length: 12 }, (_, i) => buildGeneralSet(`general:2026-10-12:${i}`, '2026-10-12', undefined, pool));
    for (const set of sets) {
      expect(set).toHaveLength(20);
      expect(set.filter((q) => q.id.startsWith('gp:'))).toHaveLength(14);
    }
    // 14 distinct records inside a set even though the pool has only 20.
    const ids = sets[11].filter((q) => q.id.startsWith('gp:')).map((q) => q.id.split(':')[1]);
    expect(new Set(ids).size).toBe(14);
    expect(buildGeneralSet('general:2026-10-12:11', '2026-10-12', undefined, pool)).toEqual(sets[11]);
  });

  it('survives a pool smaller than a set', () => {
    const pool = livePackRecords().slice(0, 5);
    const set = buildGeneralSet('general:2026-10-12:2', '2026-10-12', undefined, pool);
    expect(set.filter((q) => q.id.startsWith('gp:'))).toHaveLength(5);
  });

  it('is not served by generateMatch', () => {
    expect(() => generateMatch(10, 0.3, 'general')).toThrow(RangeError);
    expect(generalPackQuestions.length).toBeGreaterThan(0);
  });
});
