import { describe, expect, it } from 'vitest';
import { clearDailyBankCache, dailyBankSize, dailyQuestionBank, dailyQuestionSet, dayStartMs } from '../solo/dailyQuestionSet';
import {
  BALANCED_TOPICS_FROM,
  GENERAL_SET_TOPIC_CAP,
  buildGeneralSet,
  livePackRecords,
  questionTopicKey,
  spreadTopics,
  DAILY_CURATED_FROM,
  dailyPackPool,
  dailyRulesAllow,
  isDailyEligible,
  liveDailyRecords,
  liveEverywhereRecords,
} from './generalSet';
import { generalPackQuestions, generalPackSets } from '../generalPack';
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

  it('does not put open country outlines into new general sets', () => {
    for (let index = 0; index < 12; index++) {
      const questions = buildGeneralSet(`general:2026-10-12:${index}`, '2026-10-12');
      expect(questions.some((question) => question.id.startsWith('open_outline_country_'))).toBe(false);
    }
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

describe('topic balance of the general set', () => {
  const BALANCED_DAY = Date.UTC(2026, 10, 15, 10);

  it('never puts two questions of one topic next to each other and caps a topic at 3 pack questions', () => {
    for (let day = 0; day < 14; day++) {
      clearDailyBankCache();
      for (const { questions } of dailyQuestionBank('general', BALANCED_DAY + day * 86_400_000)) {
        const keys = questions.map(questionTopicKey);
        keys.slice(1).forEach((key, index) => expect(key).not.toBe(keys[index]));
        const packTopics = new Map<string, number>();
        for (const q of questions.filter((item) => item.id.startsWith('gp:'))) {
          packTopics.set(questionTopicKey(q), (packTopics.get(questionTopicKey(q)) ?? 0) + 1);
        }
        expect(Math.max(...packTopics.values())).toBeLessThanOrEqual(GENERAL_SET_TOPIC_CAP);
      }
    }
  });

  it('keeps the sets of earlier days exactly as they were played', () => {
    // 2026-11-14: до включения баланса. Порядок этого набора уже в таблице дня.
    const before = buildGeneralSet('general:2026-11-14:0', '2026-11-14').map(questionTopicKey);
    expect(before.slice(0, 4)).toEqual(['Наука', 'Наука', 'Наука', 'Наука']);
    expect(BALANCED_TOPICS_FROM).toBe('2026-11-15');
  });

  it('spreads topics deterministically and leaves a single-topic list as is', () => {
    const items = ['a1', 'a2', 'a3', 'b1', 'b2', 'c1'];
    const key = (item: string) => item[0];
    const spread = spreadTopics(items, key);
    expect(spread).toEqual(spreadTopics(items, key));
    expect([...spread].sort()).toEqual([...items].sort());
    spread.slice(1).forEach((item, index) => expect(key(item)).not.toBe(key(spread[index])));
    expect(spreadTopics(['x1', 'x2'], key)).toEqual(['x1', 'x2']);
  });
});

describe('daily run pool (from DAILY_CURATED_FROM)', () => {
  const single = (promptRu: string, extra: Record<string, unknown> = {}) => ({
    id: 'x', kind: 'single', topic: 'science', difficulty: 'Medium', promptRu, answerRu: 'a', acceptedRu: ['a'],
    distractorsRu: ['b', 'c', 'd'], openAnswer: false, origin: 'authored', license: 'original', editorialStatus: 'approved', ...extra,
  }) as unknown as Parameters<typeof isDailyEligible>[0];

  it('keeps everyday erudition and drops cramming', () => {
    expect(dailyRulesAllow(single('Какой газ составляет большую часть атмосферы Земли?'))).toBe(true);
    expect(dailyRulesAllow(single('Какой атомный номер у элемента «водород»?'))).toBe(true);
    expect(dailyRulesAllow(single('Какой атомный номер у элемента «астат»?'))).toBe(false);
    expect(dailyRulesAllow(single('Какой символ у химического элемента «железо»?'))).toBe(false);
    expect(dailyRulesAllow(single('Какой химический элемент обозначается символом Fe?'))).toBe(true);
    expect(dailyRulesAllow(single('Какой химический элемент обозначается символом Cf?'))).toBe(false);
    expect(dailyRulesAllow(single('Что-то очень узкое?', { difficulty: 'Expert' }))).toBe(false);
    expect(isDailyEligible(single('Нормальный вопрос?', { daily: false }))).toBe(false);
    expect(isDailyEligible(single('Какой атомный номер у элемента «астат»?', { daily: true }))).toBe(true);
  });

  it('keeps only famous works from the Wikidata templates', () => {
    expect(dailyRulesAllow(single('Кто написал картину «Мона Лиза»?', { origin: 'wikidata' }))).toBe(true);
    expect(dailyRulesAllow(single('Кто композитор произведения «Сельская честь»?', { origin: 'wikidata' }))).toBe(false);
    expect(dailyRulesAllow(single('Кто автор произведения «Сон в красном тереме»?', { origin: 'wikidata' }))).toBe(false);
    expect(dailyRulesAllow(single('Какую из этих картин написал Питер Брейгель Старший?', { origin: 'wikidata' }))).toBe(false);
    expect(dailyRulesAllow(single('Какое из этих произведений написал Жюль Верн?', { origin: 'wikidata' }))).toBe(true);
  });

  it('is a subset of the everywhere pool and leaves earlier days alone', () => {
    const everywhere = new Set(liveEverywhereRecords().map((record) => record.id));
    expect(liveDailyRecords().every((record) => everywhere.has(record.id))).toBe(true);
    expect(dailyPackPool('2026-11-23').some((record) => record.id.startsWith('er-'))).toBe(false);
    expect(dailyPackPool(DAILY_CURATED_FROM).length).toBe(liveDailyRecords().length);
  });

  it('swaps historic and US state flags for country flags, capitals and languages', () => {
    clearDailyBankCache();
    const curated = dailyQuestionSet('general', dayStartMs(DAILY_CURATED_FROM) + 60_000, 0).questions;
    expect(curated.some((question) => question.category === 'Historical Flags')).toBe(false);
    expect(curated.filter((question) => question.category === 'Languages')).toHaveLength(2);
    const before = dailyQuestionSet('general', dayStartMs('2026-11-23') + 60_000, 0).questions;
    expect(before.filter((question) => question.category === 'Historical Flags')).toHaveLength(2);
  });
});

describe('daily flag on content', () => {
  it('is set explicitly on every record, so nothing lands in the daily run by default', () => {
    const records = [...generalPackQuestions, ...generalPackSets] as Array<{ id: string; daily?: unknown; topic: string }>;
    expect(records.filter((record) => typeof record.daily !== 'boolean').map((record) => record.id)).toEqual([]);
    expect(records.filter((record) => record.topic === 'kazakhstan' && record.daily === true).map((record) => record.id)).toEqual([]);
  });
});
