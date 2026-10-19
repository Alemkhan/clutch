import { describe, expect, it } from 'vitest';
import { dailySetSize } from './dailyQuestionSet';
import { freshQuestionSet } from './freshQuestionSet';
import { KZ_MIN_LIVE, KZ_SET_OPEN_COUNT, KZ_SET_SIZE, buildKzSet, isCategoryOpen, liveKzRecords, livePackRecords } from './generalSet';
import { generalPackQuestions, PACK_TOPIC_LABELS_RU, type PackRecord } from './generalPack';

// Вопросы темы лежат на проверке (pending); тесты играют ими как одобренными.
const kz: PackRecord[] = generalPackQuestions
  .filter((q) => q.topic === 'kazakhstan')
  .map((q) => ({ ...q, editorialStatus: 'approved' as const }));

describe('История Казахстана', () => {
  it('has enough authored questions to open once approved', () => {
    expect(kz.length).toBeGreaterThanOrEqual(KZ_MIN_LIVE);
    expect(isCategoryOpen('kz_history', kz)).toBe(true);
  });

  it('stays «Скоро» until enough questions are approved; other categories are always open', () => {
    expect(isCategoryOpen('kz_history', kz.slice(0, KZ_MIN_LIVE - 1))).toBe(false);
    expect(isCategoryOpen('general', [])).toBe(true);
    expect(isCategoryOpen('geography', [])).toBe(true);
  });

  it('never lets an unapproved question reach players', () => {
    for (const record of liveKzRecords()) expect(record.editorialStatus).toBe('approved');
  });

  it('builds a deterministic set of the category only, with a few typed answers', () => {
    const a = buildKzSet('kz_history:2026-10-19:0', '2026-10-19', kz);
    expect(a).toHaveLength(KZ_SET_SIZE);
    expect(dailySetSize('kz_history')).toBe(KZ_SET_SIZE);
    expect(a.every((q) => q.id.startsWith('gp:kz-') && q.subcategory === PACK_TOPIC_LABELS_RU.kazakhstan)).toBe(true);
    expect(a.filter((q) => q.answerType === 'open_answer').length).toBeLessThanOrEqual(KZ_SET_OPEN_COUNT);
    expect(new Set(a.map((q) => q.id)).size).toBe(KZ_SET_SIZE);
    expect(buildKzSet('kz_history:2026-10-19:0', '2026-10-19', kz)).toEqual(a);
    // Соседний набор дня берёт следующее окно пула.
    const b = buildKzSet('kz_history:2026-10-19:1', '2026-10-19', kz);
    expect(b.filter((q) => a.some((x) => x.id.split(':')[1] === q.id.split(':')[1]))).toHaveLength(0);
  });

  it('a fresh set prefers questions the player has not seen', () => {
    const first = freshQuestionSet('kz_history', 'seed', new Set(), Date.UTC(2026, 9, 19), [], kz);
    expect(first.questions).toHaveLength(KZ_SET_SIZE);
    const seen = new Set(first.questions.map((q) => q.id.replace(/:(open|mc)$/u, '')));
    const next = freshQuestionSet('kz_history', 'seed-2', seen, Date.UTC(2026, 9, 19), [], kz);
    expect(next.questions.some((q) => seen.has(q.id.replace(/:(open|mc)$/u, '')))).toBe(false);
  });

  it('only questions most of the CIS knows enter general knowledge', () => {
    const general = livePackRecords();
    expect(general.some((r) => r.topic === 'kazakhstan' && !(r.kind === 'single' && r.generalPool))).toBe(false);
    const shared = kz.filter((r) => r.kind === 'single' && r.generalPool);
    expect(shared.length).toBeGreaterThan(0);
    expect(shared.length).toBeLessThan(kz.length / 2);
  });
});
