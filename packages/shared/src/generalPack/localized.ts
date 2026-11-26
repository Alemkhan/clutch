/**
 * Языковые версии и гео-зоны записей пакета. Карточка вопроса: русский оригинал в content/questions,
 * переводы в content/i18n/<locale>/pack.json (собирает `npm run content:i18n`), зоны в
 * content/i18n/regions.json. Перевода нет - показывается русский текст; разметки нет - запись везде.
 */
import en from '../../../../content/i18n/en/pack.json';
import kk from '../../../../content/i18n/kk/pack.json';
import regionsJson from '../../../../content/i18n/regions.json';
import type { Question } from '../index';
import type { Locale, Region } from '../i18n/locale';
import { contentQuestions as generalPackQuestions, contentSets as generalPackSets } from './content';
import type { PackQuestion, PackSet } from './types';

interface QuestionTranslation {
  prompt: string;
  answer: string;
  accepted: string[];
  distractors: string[];
  explanation?: string;
}

interface SetTranslation {
  title: string;
  mcPrompt: string;
  members: Record<string, { answer: string; accepted: string[] }>;
  nonMembers: string[];
}

interface PackTranslations {
  questions: Record<string, QuestionTranslation>;
  sets: Record<string, SetTranslation>;
}

const TRANSLATIONS: Readonly<Record<Exclude<Locale, 'ru'>, PackTranslations>> = {
  en: en as PackTranslations,
  kk: kk as PackTranslations,
};
const REGIONS = regionsJson as Record<string, Region[]>;
const ALL_REGIONS: readonly Region[] = ['kz', 'cis', 'world'];

const questionsById = new Map<string, PackQuestion>(generalPackQuestions.map((record) => [record.id, record]));
const setsById = new Map<string, PackSet>(generalPackSets.map((record) => [record.id, record]));

/** Зоны записи пакета; без разметки - везде. */
export function packRecordRegions(recordId: string): readonly Region[] {
  return REGIONS[recordId] ?? ALL_REGIONS;
}

const CORRECT_ANSWER: Readonly<Record<Locale, (answer: string) => string>> = {
  ru: (answer) => `Правильный ответ: ${answer}.`,
  en: (answer) => `Correct answer: ${answer}.`,
  kk: (answer) => `Дұрыс жауап: ${answer}.`,
};

const SET_EXPLANATION: Readonly<Record<Locale, (answer: string, title: string, members: string) => string>> = {
  ru: (answer, title, members) => `Правильный ответ: ${answer}. ${title}: ${members}.`,
  en: (answer, title, members) => `${answer} is correct. ${title}: ${members}.`,
  kk: (answer, title, members) => `Дұрыс жауап: ${answer}. ${title}: ${members}.`,
};

function unique(items: readonly string[]): string[] {
  return [...new Set(items.filter((item) => item.trim().length > 0))];
}

/** Запись пакета и её номер участника по id вопроса забега (`gp:<id>:mc|open` или `gp:<setId>:<memberId>`). */
function packSource(questionId: string): { question?: PackQuestion; set?: PackSet; memberId?: string } {
  if (!questionId.startsWith('gp:')) return {};
  const rest = questionId.slice(3);
  const cut = rest.lastIndexOf(':');
  if (cut < 0) return {};
  const recordId = rest.slice(0, cut);
  const tail = rest.slice(cut + 1);
  const question = questionsById.get(recordId);
  if (question) return { question };
  const set = setsById.get(recordId);
  return set ? { set, memberId: tail } : {};
}

/**
 * Засчитываемые ответы на всех языках: открытый ответ принимается по-русски, по-английски и
 * по-казахски, чтобы никто не проигрывал из-за перевода. Первыми - ответы языка игрока.
 */
export function acceptedAnswersAllLocales(question: Pick<Question, 'id' | 'correctAnswers'>, first: Locale = 'ru'): string[] {
  const { question: record, set, memberId } = packSource(question.id);
  const base = question.correctAnswers ?? [];
  const byLocale = (locale: Exclude<Locale, 'ru'>): string[] => {
    if (record) return TRANSLATIONS[locale].questions[record.id]?.accepted ?? [];
    if (set && memberId) return TRANSLATIONS[locale].sets[set.id]?.members[memberId]?.accepted ?? [];
    return [];
  };
  const order: Exclude<Locale, 'ru'>[] = first === 'kk' ? ['kk', 'en'] : ['en', 'kk'];
  const translated = order.flatMap(byLocale);
  return unique(first === 'ru' ? [...base, ...translated] : [...byLocale(first), ...base, ...translated]);
}

/**
 * Вопрос пакета на языке игрока. Id, порядок и id вариантов не меняются - меняется только текст,
 * поэтому набор дня, ответ и таблица общие для всех языков. Не из пакета или без перевода - как есть.
 */
export function localizePackQuestion(question: Question, locale: Locale): Question {
  if (locale === 'ru') return question;
  const { question: record, set, memberId } = packSource(question.id);
  const translations = TRANSLATIONS[locale];

  if (record) {
    const t = translations.questions[record.id];
    if (!t) return question;
    const optionText = new Map<string, string>([[record.answerRu, t.answer]]);
    record.distractorsRu.forEach((text, index) => {
      if (t.distractors[index]) optionText.set(text, t.distractors[index]);
    });
    return {
      ...question,
      prompt: t.prompt,
      options: question.options.map((option) => ({ ...option, text: optionText.get(option.text) ?? option.text })),
      correctAnswers: acceptedAnswersAllLocales(question, locale),
      explanation: t.explanation ?? CORRECT_ANSWER[locale](t.answer),
    };
  }

  if (set && memberId) {
    const t = translations.sets[set.id];
    if (!t) return question;
    const optionText = new Map<string, string>();
    for (const member of set.members) {
      const translated = t.members[member.id]?.answer;
      if (translated) optionText.set(member.answerRu, translated);
    }
    set.nonMembersRu.forEach((text, index) => {
      if (t.nonMembers[index]) optionText.set(text, t.nonMembers[index]);
    });
    const answer = t.members[memberId]?.answer ?? set.members.find((member) => member.id === memberId)?.answerRu ?? '';
    const members = set.members.map((member) => t.members[member.id]?.answer ?? member.answerRu).join(', ');
    return {
      ...question,
      prompt: t.mcPrompt,
      options: question.options.map((option) => ({ ...option, text: optionText.get(option.text) ?? option.text })),
      correctAnswers: acceptedAnswersAllLocales(question, locale),
      explanation: SET_EXPLANATION[locale](answer, t.title, members),
    };
  }

  return question;
}
