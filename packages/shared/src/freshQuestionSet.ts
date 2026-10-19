import { countries } from './countries';
import { DAILY_SET_OPEN_RATIO, dailyKey, dailySetSize, type DailySet } from './dailyQuestionSet';
import { packQuestionToRaceQuestion, packSetToRaceQuestion, type PackRecord } from './generalPack';
import {
  GENERAL_SET_GENERATED,
  GENERAL_SET_OPEN_COUNT,
  GENERAL_SET_PACK_COUNT,
  KZ_SET_OPEN_COUNT,
  liveKzRecords,
  livePackRecords,
} from './generalSet';
import { historicFlags } from './historicFlags';
import type { CategoryId, GeneratedCategoryId, Question } from './index';
import { languages } from './languages';
import { generateMatch } from './questionGenerator';
import { createSeededRandom, hashSeed } from './seededRandom';

/**
 * Свежий набор для свободной игры и дуэли: собирается под забег, а не берётся из банка дня.
 * Раньше все забеги шли по наборам дня, и после 6–12 забегов вопросы начинали ходить по кругу.
 *
 * Сначала берутся вопросы, которых игрок ещё не видел (`seen` — ключи `seenQuestionKey`), и только
 * если их не хватает — уже виденные, в том же случайном порядке. Детерминирован по `seed`.
 */

/** Ключ «того же вопроса»: пакетная запись в формате выбора и открытого ввода — один и тот же вопрос. */
export function seenQuestionKey(questionId: string): string {
  return questionId.replace(/:(open|mc)$/u, '');
}

const CAPACITY: Readonly<Record<GeneratedCategoryId, number>> = {
  geography: countries.length,
  history: historicFlags.length,
  languages: languages.length,
};

function shuffled<T>(items: readonly T[], seed: string): T[] {
  const random = createSeededRandom(hashSeed(seed));
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Первые `count` элементов, невиденные впереди; порядок внутри групп сохраняется. */
function unseenFirst<T>(items: readonly T[], keyOf: (item: T) => string, seen: ReadonlySet<string>, count: number): T[] {
  const fresh = items.filter((item) => !seen.has(keyOf(item)));
  const known = items.filter((item) => seen.has(keyOf(item)));
  return [...fresh, ...known].slice(0, count);
}

/** Кандидаты генератора с запасом: из них выбираются невиденные. */
function generatedCandidates(category: GeneratedCategoryId, wanted: number, openRatio: number, seed: string): Question[] {
  const count = Math.min(CAPACITY[category], wanted * 4);
  return generateMatch(count, openRatio, category, createSeededRandom(hashSeed(seed)));
}

/** Невиденные записи пакета впереди; открытым вводом — до `openCount` из тех, где он разрешён. */
function freshPackQuestions(seed: string, seen: ReadonlySet<string>, pool: readonly PackRecord[], count: number, openCount: number): Question[] {
  const records = unseenFirst(shuffled(pool, `${seed}:pack`), (record) => `gp:${record.id}`, seen, count);
  const open = new Set(
    shuffled(records.filter((r) => r.kind === 'single' && r.openAnswer).map((r) => r.id), `${seed}:open`)
      .slice(0, openCount),
  );
  return records.map((record) => {
    const questionSeed = `${seed}:${record.id}`;
    if (record.kind === 'set') return packSetToRaceQuestion(record, questionSeed);
    return packQuestionToRaceQuestion(record, open.has(record.id) ? 'open_answer' : 'multiple_choice', questionSeed);
  });
}

function freshGeneralQuestions(seed: string, seen: ReadonlySet<string>, pool: readonly PackRecord[]): Question[] {
  const packQuestions = freshPackQuestions(seed, seen, pool, GENERAL_SET_PACK_COUNT, GENERAL_SET_OPEN_COUNT);
  const generated = GENERAL_SET_GENERATED.flatMap(({ category, count }) =>
    unseenFirst(generatedCandidates(category, count, DAILY_SET_OPEN_RATIO, `${seed}:${category}`), (q) => seenQuestionKey(q.id), seen, count));
  return [...packQuestions, ...generated];
}

export function freshQuestionSet(
  category: CategoryId,
  seed: string,
  seen: ReadonlySet<string> = new Set(),
  timestampMs: number = Date.now(),
  pool: readonly PackRecord[] = livePackRecords(),
  kzPool: readonly PackRecord[] = liveKzRecords(),
): DailySet {
  const dateKey = dailyKey(timestampMs);
  const questionSetId = `fresh:${category}:${dateKey}:${hashSeed(`fresh:${seed}`)}`;
  const questions = category === 'general'
    ? freshGeneralQuestions(questionSetId, seen, pool)
    : category === 'kz_history'
    ? freshPackQuestions(questionSetId, seen, kzPool, dailySetSize(category), KZ_SET_OPEN_COUNT)
    : unseenFirst(
      generatedCandidates(category, dailySetSize(category), DAILY_SET_OPEN_RATIO, questionSetId),
      (q) => seenQuestionKey(q.id),
      seen,
      dailySetSize(category),
    );
  const createdAt = `${dateKey}T00:00:00.000Z`;
  return {
    questionSetId,
    questions: shuffled(questions, `${questionSetId}:order`).map((question) => ({ ...question, createdAt })),
  };
}
