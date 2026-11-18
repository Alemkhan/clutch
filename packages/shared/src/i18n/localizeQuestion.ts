import type { Question } from '../index';
import { localizePackQuestion } from '../generalPack/localized';
import { localizeGeneratedQuestion, SUBCATEGORY_LABELS } from '../questions/localizedGenerated';
import type { Locale } from './locale';

/** Любой вопрос забега на языке игрока: записи пакета и вопросы генераторов. */
export function localizeQuestion(question: Question, locale: Locale): Question {
  if (locale === 'ru') return question;
  if (!question.id.startsWith('gp:')) return localizeGeneratedQuestion(question, locale);
  const localized = localizePackQuestion(question, locale);
  const subcategory = localized.subcategory ? SUBCATEGORY_LABELS[locale][localized.subcategory] : undefined;
  return subcategory ? { ...localized, subcategory } : localized;
}

/**
 * Все засчитываемые открытые ответы на трёх языках: игрок может ответить на любом, даже если
 * играет на другом. Порядок не важен — это список для сверки.
 */
export function acceptedAnswersAnyLanguage(question: Question): string[] {
  const all = [
    ...(question.correctAnswers ?? []),
    ...(localizeQuestion(question, 'en').correctAnswers ?? []),
    ...(localizeQuestion(question, 'kk').correctAnswers ?? []),
  ];
  return [...new Set(all)];
}
