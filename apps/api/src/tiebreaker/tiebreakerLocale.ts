/**
 * «На глазок» на языке игрока. Вопросы дня лежат в D1 по-русски; переводы - в
 * content/i18n/<locale>/tiebreaker.json по id вопроса. Числа, ответ и ссылки берутся из базы,
 * из перевода - только текст (формулировки, единицы, подписи шагов разбора, итог).
 */
import en from '../../../../content/i18n/en/tiebreaker.json';
import kk from '../../../../content/i18n/kk/tiebreaker.json';
import type { Locale } from '@clutch/shared';
import type { TiebreakerQuestionRow } from './tiebreakerRepository';

interface StepText { label?: string; unit?: string; sourceTitle?: string }
interface TiebreakerText {
  prompt?: string;
  cardPrompt?: string;
  unit?: string;
  explanation?: { steps?: StepText[]; summary?: string };
}

const TEXT: Record<Exclude<Locale, 'ru'>, Record<string, TiebreakerText>> = {
  en: en as Record<string, TiebreakerText>,
  kk: kk as Record<string, TiebreakerText>,
};

function localizedExplanation(raw: string, text: TiebreakerText['explanation']): string {
  if (!text) return raw;
  try {
    const parsed = JSON.parse(raw) as { steps?: Record<string, unknown>[]; summary?: unknown };
    const steps = parsed.steps?.map((step, index) => {
      const t = text.steps?.[index];
      return t ? {
        ...step,
        ...(t.label ? { label: t.label } : {}),
        ...(t.unit ? { unit: t.unit } : {}),
        ...(t.sourceTitle ? { sourceTitle: t.sourceTitle } : {}),
      } : step;
    });
    return JSON.stringify({ ...parsed, ...(steps ? { steps } : {}), ...(text.summary ? { summary: text.summary } : {}) });
  } catch {
    return raw;
  }
}

export function localizeTiebreakerQuestion(question: TiebreakerQuestionRow, locale: Locale): TiebreakerQuestionRow {
  if (locale === 'ru') return question;
  const t = TEXT[locale][question.id];
  if (!t) return question;
  return {
    ...question,
    prompt: t.prompt ?? question.prompt,
    cardPrompt: t.cardPrompt ?? question.cardPrompt,
    unit: t.unit ?? question.unit,
    explanationJson: localizedExplanation(question.explanationJson, t.explanation),
  };
}
