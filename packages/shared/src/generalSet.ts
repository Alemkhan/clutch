import type { Question } from './index';
import { generateMatch, type TemplateUsage } from './questionGenerator';
import {
  generalPackQuestions,
  generalPackSets,
  isPackRecordLive,
  packQuestionToRaceQuestion,
  packSetToRaceQuestion,
  type PackRecord,
} from './generalPack';
import { createSeededRandom, hashSeed } from './seededRandom';

/**
 * Набор дня общего режима: смешанный, 70% записей пакета + 30% вопросов генераторов
 * (решение владельца 2026-10-12). 20 вопросов = 14 из пакета + 6 из генераторов
 * (3 география, 2 история, 1 языки). Из 14 пакетных 4 (~30%) подаются открытым вводом.
 */
export const GENERAL_SET_PACK_COUNT = 14;
export const GENERAL_SET_OPEN_COUNT = 4;
export const GENERAL_SET_GENERATED: ReadonlyArray<{ category: 'geography' | 'history' | 'languages'; count: number }> = [
  { category: 'geography', count: 3 },
  { category: 'history', count: 2 },
  { category: 'languages', count: 1 },
];
/** Доля открытых ответов внутри генераторной части, как у остальных наборов дня. */
const GENERATED_OPEN_RATIO = 0.3;

function shuffled<T>(items: readonly T[], seed: string): T[] {
  const random = createSeededRandom(hashSeed(seed));
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Записи пакета, которые видят игроки: только одобренные. */
export function livePackRecords(): PackRecord[] {
  return [...generalPackQuestions, ...generalPackSets].filter(isPackRecordLive);
}

/**
 * Окно из `count` записей начиная с позиции `start` в дневном порядке. Порядок дня — перемешанный
 * по `general:<dateKey>` пул; если одобренных записей не хватает на весь банк, список идёт по кругу,
 * и каждый следующий круг перемешивается своим сидом (`...:cycle<n>`). Запись в окне не повторяется.
 */
function packWindow(pool: readonly PackRecord[], dateKey: string, start: number, count: number): PackRecord[] {
  if (pool.length === 0) return [];
  const base = `general:${dateKey}`;
  const cycles = new Map<number, PackRecord[]>();
  const at = (position: number): PackRecord => {
    const cycle = Math.floor(position / pool.length);
    let order = cycles.get(cycle);
    if (!order) {
      order = shuffled(pool, cycle === 0 ? base : `${base}:cycle${cycle}`);
      cycles.set(cycle, order);
    }
    return order[position % pool.length];
  };
  const out: PackRecord[] = [];
  const seen = new Set<string>();
  const limit = start + count + pool.length;
  for (let position = start; position < limit && out.length < count; position++) {
    const record = at(position);
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    out.push(record);
  }
  return out;
}

/** Индекс набора в банке дня из его id (`general:2026-10-12:3` даёт 3). */
function setIndexOf(questionSetId: string): number {
  const index = Number(questionSetId.slice(questionSetId.lastIndexOf(':') + 1));
  if (!Number.isInteger(index) || index < 0) throw new RangeError(`Bad question set id: ${questionSetId}`);
  return index;
}

/**
 * Один набор общего режима. Детерминирован: одинаковые `questionSetId` и день всегда дают
 * байт-идентичный набор. `usage` — общий ledger шаблонов всего банка дня, как у других категорий.
 * `pool` нужен только тестам (нехватка одобренных записей).
 */
export function buildGeneralSet(
  questionSetId: string,
  dateKey: string,
  usage?: TemplateUsage,
  pool: readonly PackRecord[] = livePackRecords(),
): Question[] {
  const index = setIndexOf(questionSetId);
  const records = packWindow(pool, dateKey, index * GENERAL_SET_PACK_COUNT, GENERAL_SET_PACK_COUNT);

  // Открытым вводом - только одиночные записи, у которых он разрешён; выбор детерминирован.
  const open = new Set(
    shuffled(
      records.filter((r) => r.kind === 'single' && r.openAnswer).map((r) => r.id),
      `${questionSetId}:open`,
    ).slice(0, GENERAL_SET_OPEN_COUNT),
  );

  const packQuestions = records.map((record) => {
    const seed = `${questionSetId}:${record.id}`;
    if (record.kind === 'set') return packSetToRaceQuestion(record, seed);
    return packQuestionToRaceQuestion(record, open.has(record.id) ? 'open_answer' : 'multiple_choice', seed);
  });

  const generated = GENERAL_SET_GENERATED.flatMap(({ category, count }) =>
    generateMatch(count, GENERATED_OPEN_RATIO, category, createSeededRandom(hashSeed(`${questionSetId}:${category}`)), usage),
  );

  // createdAt is wall-clock in the generators; pin it so the set is byte-identical for everyone.
  const createdAt = `${dateKey}T00:00:00.000Z`;
  return shuffled([...packQuestions, ...generated], `${questionSetId}:order`).map((q) => ({ ...q, createdAt }));
}
