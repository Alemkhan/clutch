import { describe, expect, it } from 'vitest';
import { generateMatch, generateQuestionById, isKnownQuestionId, questionIdCategory } from './index';

describe('generateQuestionById', () => {
  it.each([
    'flag_country_kr',
    'capital_li',
    'flag_capital_kr',
    'outline_country_md',
    'open_outline_country_md',
    'open_capital_ru',
    'open_flag_country_fr',
    'capital_fixed_fr',
    'hist_flag_soviet-union',
    'lang_ka',
  ])('rebuilds %s with the same id', (id) => {
    const question = generateQuestionById(id);
    expect(question).not.toBeNull();
    expect(question!.id).toBe(id);
    expect(isKnownQuestionId(id)).toBe(true);
    if (question!.answerType === 'multiple_choice') {
      expect(question!.options.some((o) => o.id === question!.correctOptionId)).toBe(true);
    } else {
      expect(question!.correctAnswers?.length).toBeGreaterThan(0);
    }
  });

  it('rebuilds every id the match generator can produce', () => {
    for (const category of ['geography', 'history', 'languages'] as const) {
      for (const q of generateMatch(10, 0.3, category)) {
        expect(generateQuestionById(q.id)?.id).toBe(q.id);
      }
    }
  });

  it.each([
    '', 'garbage', 'capital_', 'capital_zz', 'outline_country_xk', 'lang_nope', 'hist_flag_nope',
    'unknown_kr', '__proto__', 'capital_constructor',
  ])('returns null for %j', (id) => {
    expect(generateQuestionById(id)).toBeNull();
    expect(isKnownQuestionId(id)).toBe(false);
  });

  it('returns null for non-string input', () => {
    expect(generateQuestionById(undefined)).toBeNull();
    expect(generateQuestionById(42)).toBeNull();
    expect(generateQuestionById({})).toBeNull();
  });

  it('reports the category', () => {
    expect(questionIdCategory('capital_li')).toBe('geography');
    expect(questionIdCategory('hist_flag_gdr')).toBe('history');
    expect(questionIdCategory('lang_ka')).toBe('languages');
    expect(questionIdCategory('nope')).toBeNull();
  });
});
