import { describe, expect, it } from 'vitest';
import { packQuestionToRaceQuestion, packSetToRaceQuestion } from './convert';
import { generalPackQuestions, generalPackSets } from './index';
import { acceptedAnswersAllLocales, localizePackQuestion, packRecordRegions } from './localized';

const record = generalPackQuestions.find((item) => item.id === 'au-science-1i6qjj') ?? generalPackQuestions[0];

describe('localized pack questions', () => {
  it('keeps ids, option ids and the right option, changing only the text', () => {
    const ru = packQuestionToRaceQuestion(record, 'multiple_choice', 'seed');
    const en = localizePackQuestion(ru, 'en');
    expect(en.id).toBe(ru.id);
    expect(en.options.map((option) => option.id)).toEqual(ru.options.map((option) => option.id));
    expect(en.correctOptionId).toBe(ru.correctOptionId);
    expect(en.prompt).not.toBe(ru.prompt);
    expect(en.options.every((option) => !/[а-яё]/i.test(option.text))).toBe(true);
    expect(localizePackQuestion(ru, 'ru')).toBe(ru);
  });

  it('accepts a typed answer in any language, the player language first', () => {
    const ru = packQuestionToRaceQuestion(record, 'multiple_choice', 'seed');
    const accepted = acceptedAnswersAllLocales(ru, 'en');
    expect(accepted.length).toBeGreaterThan((ru.correctAnswers ?? []).length);
    expect(accepted).toEqual(expect.arrayContaining(ru.correctAnswers ?? []));
  });

  it('translates a closed-category question and its options', () => {
    const set = generalPackSets.find((item) => item.id === 'set-traffic-light') ?? generalPackSets[0];
    const ru = packSetToRaceQuestion(set, 'seed');
    const en = localizePackQuestion(ru, 'en');
    expect(en.options.map((option) => option.id)).toEqual(ru.options.map((option) => option.id));
    expect(en.prompt).not.toBe(ru.prompt);
  });

  it('knows the zones of a record and treats unmarked ones as everywhere', () => {
    expect(packRecordRegions('kz-tomyris')).toEqual(['kz']);
    expect(packRecordRegions('no-such-record')).toEqual(['kz', 'cis', 'world']);
  });
});
