import { describe, expect, it } from 'vitest';
import { dailyQuestionBank } from './dailyQuestionSet';
import { isKnownQuestionId, questionIdCategory, resolveQuestionById } from './questionResolve';

const DAY = Date.UTC(2026, 9, 12);

describe('question resolve facade', () => {
  const questions = dailyQuestionBank('general', DAY).flatMap((s) => s.questions);

  it('restores every id of the general daily bank', () => {
    expect(questions.length).toBe(240);
    for (const q of questions) {
      const back = resolveQuestionById(q.id);
      expect(back, q.id).not.toBeNull();
      expect(back!.id).toBe(q.id);
      expect(isKnownQuestionId(q.id), q.id).toBe(true);
      if (back!.answerType === 'open_answer') {
        expect(back!.correctAnswers!.length, q.id).toBeGreaterThan(0);
        expect(back!.correctAnswers!.every((a) => a.trim() !== ''), q.id).toBe(true);
      } else {
        expect(back!.options.some((o) => o.id === back!.correctOptionId), q.id).toBe(true);
      }
    }
  });

  it('categorises pack ids as general and generator ids as before', () => {
    expect(questionIdCategory(questions.find((q) => q.id.startsWith('gp:'))!.id)).toBe('general');
    expect(questionIdCategory('lang_ru')).not.toBe('general');
  });

  it('returns null for junk', () => {
    for (const id of ['gp:', 'gp:nope:open', 'gp:set-solar-planets:nobody', 'gp:set-nope:x', 'gp:wd-book-Q25338', 'gp:wd-book-Q25338:zzz', 'xx', '', null, 5]) {
      expect(resolveQuestionById(id), String(id)).toBeNull();
      expect(isKnownQuestionId(id)).toBe(false);
      expect(questionIdCategory(id)).toBeNull();
    }
  });
});
