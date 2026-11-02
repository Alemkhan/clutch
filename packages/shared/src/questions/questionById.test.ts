import { describe, expect, it } from 'vitest';
import { generateMatch, generateQuestionById, isKnownQuestionId, questionIdCategory } from '../index';
import { historicFlagPool, historicFlags } from './historicFlags';

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

  it('still rebuilds a legacy open country outline id', () => {
    const question = generateQuestionById('open_outline_country_md');
    expect(question).toMatchObject({
      id: 'open_outline_country_md',
      answerType: 'open_answer',
      mediaType: 'outline',
    });
  });

  it.each([
    ['capital_bz', 'Какой город — столица страны Белиз?'],
    ['flag_capital_bz', 'Какой город — столица страны с этим флагом?'],
    ['open_capital_bz', 'Напишите название города — столицы страны Белиз.'],
    ['capital_fixed_bz', 'Напишите название города — столицы страны Белиз.'],
  ])('uses an unambiguous capital prompt for %s', (id, prompt) => {
    const question = generateQuestionById(id);
    expect(question?.prompt).toBe(prompt);
    expect(question?.prompt).toMatch(/город.*столиц/u);
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

  it('includes only reviewed free municipal and state symbols from the new inventory', () => {
    const added = historicFlags.filter((flag) => flag.id.startsWith('other-'));
    expect(added.length).toBeGreaterThanOrEqual(90);
    expect(added.every((flag) => flag.mediaUrl?.startsWith('https://thumb.wikimedia.org/') || flag.mediaUrl?.startsWith('https://upload.wikimedia.org/'))).toBe(true);
    expect(added.some((flag) => /миссисипи/i.test(flag.labelRu))).toBe(false);
    expect(added.some((flag) => /организац|юнеско|содружество|европейский союз/i.test(flag.labelRu))).toBe(false);
    expect(new Set(added.map((flag) => flag.labelRu)).size).toBe(added.length);
  });

  it('asks neutrally about a coat of arms and reconstructs its remote media', () => {
    const coat = historicFlags.find((flag) => flag.id.startsWith('other-') && flag.assetKind === 'coat_of_arms');
    expect(coat).toBeDefined();
    const question = generateQuestionById(`hist_flag_${coat!.id}`);
    expect(question).toMatchObject({ prompt: 'Что это за символ?', mediaType: 'flag', mediaUrl: coat!.mediaUrl });
    expect(question?.options.some((option) => option.text === `${coat!.labelRu} (${coat!.era})`)).toBe(true);
  });

  it.each(['us_state', 'kz_city', 'historic'] as const)('keeps %s flag answers in their own pool', (pool) => {
    const correct = historicFlags.find((flag) => historicFlagPool(flag) === pool);
    expect(correct).toBeDefined();

    const question = generateQuestionById(`hist_flag_${correct!.id}`)!;
    const optionToFlag = new Map(historicFlags.map((flag) => [`${flag.labelRu} (${flag.era})`, flag]));
    const distractors = question.options
      .filter((option) => option.id !== question.correctOptionId)
      .map((option) => optionToFlag.get(option.text));

    expect(distractors).toHaveLength(3);
    expect(distractors.every((flag) => flag && historicFlagPool(flag) === pool)).toBe(true);
  });
});
