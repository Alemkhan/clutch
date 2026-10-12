import type { CategoryId, Question } from './index';
import {
  generateQuestionById,
  isKnownQuestionId as isGeneratorQuestionId,
  questionIdCategory as generatorQuestionIdCategory,
} from './questionGenerator';
import {
  generalPackQuestions,
  generalPackSets,
  isPackRecordLive,
  packQuestionToRaceQuestion,
  packSetToRaceQuestion,
} from './generalPack';

const GP_PREFIX = 'gp:';

/** Разбор `gp:<id записи>:open|mc` и `gp:set-<id>:<id участника>`; испорченный id даёт null. */
function resolvePackId(id: unknown): Question | null {
  if (typeof id !== 'string' || !id.startsWith(GP_PREFIX)) return null;
  const rest = id.slice(GP_PREFIX.length);
  const cut = rest.lastIndexOf(':');
  if (cut <= 0 || cut === rest.length - 1) return null;
  const head = rest.slice(0, cut);
  const tail = rest.slice(cut + 1);

  if (rest.startsWith('set-')) {
    const set = generalPackSets.find((s) => s.id === head);
    if (!set || !isPackRecordLive(set) || !set.members.some((m) => m.id === tail)) return null;
    return packSetToRaceQuestion(set, set.id, tail);
  }
  if (tail !== 'open' && tail !== 'mc') return null;
  const question = generalPackQuestions.find((q) => q.id === head);
  if (!question || !isPackRecordLive(question)) return null;
  if (tail === 'open' && !question.openAnswer) return null;
  return packQuestionToRaceQuestion(question, tail === 'open' ? 'open_answer' : 'multiple_choice');
}

/** Вопрос по id: сначала генераторы, затем пакет общих знаний. Варианты ответа тянутся заново. */
export function resolveQuestionById(id: unknown): Question | null {
  return generateQuestionById(id) ?? resolvePackId(id);
}

export function isKnownQuestionId(id: unknown): boolean {
  return isGeneratorQuestionId(id) || resolvePackId(id) !== null;
}

export function questionIdCategory(id: unknown): CategoryId | null {
  return generatorQuestionIdCategory(id) ?? (resolvePackId(id) ? 'general' : null);
}
