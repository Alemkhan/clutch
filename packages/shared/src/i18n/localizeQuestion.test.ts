import { describe, expect, it } from 'vitest';
import { generateQuestionById } from '../questions/questionGenerator';
import { historicFlags } from '../questions/historicFlags';
import { acceptedAnswersAnyLanguage, localizeQuestion } from './localizeQuestion';

const cyrillic = /[а-яёәғқңөұүһі]/i;

function check(id: string) {
  const ru = generateQuestionById(id);
  expect(ru, id).not.toBeNull();
  const en = localizeQuestion(ru!, 'en');
  const kk = localizeQuestion(ru!, 'kk');
  expect(en.options.map((option) => option.id)).toEqual(ru!.options.map((option) => option.id));
  expect(en.correctOptionId).toBe(ru!.correctOptionId);
  expect(cyrillic.test(en.prompt), en.prompt).toBe(false);
  en.options.forEach((option) => expect(cyrillic.test(option.text), option.text).toBe(false));
  expect(kk.prompt).not.toBe(ru!.prompt);
  return { ru: ru!, en, kk };
}

describe('generated questions in every language', () => {
  it('flags, capitals, outlines and languages keep option ids and lose Russian text in English', () => {
    for (const id of ['flag_country_fr', 'capital_jp', 'flag_capital_br', 'outline_country_it', 'lang_ka']) check(id);
  });

  it('localizes historic and municipal flags', () => {
    check('hist_flag_soviet-union');
    const municipal = historicFlags.find((flag) => flag.inventoryId);
    if (municipal) check(`hist_flag_${municipal.id}`);
  });

  it('accepts a typed capital in Russian, English or Kazakh', () => {
    const ru = generateQuestionById('open_capital_ru');
    expect(ru).not.toBeNull();
    const accepted = acceptedAnswersAnyLanguage(ru!);
    expect(accepted).toEqual(expect.arrayContaining(['Москва', 'Moscow', 'Мәскеу']));
  });

  it('translates the topic chip of a pack question', () => {
    const { en } = { en: localizeQuestion({ ...generateQuestionById('flag_country_fr')!, subcategory: 'Флаги' }, 'en') };
    expect(en.subcategory).toBe('Flags');
  });
});
