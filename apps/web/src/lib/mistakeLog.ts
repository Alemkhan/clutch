import type { CategoryId } from '@clutch/shared';

// Таблицы стран, флагов и языков в браузер не отдаются (в них ответы), поэтому «знает ли игра этот id» клиент
// решает только по форме id: `{шаблон}_{код}`. Существует ли сущность, проверяет сервер и возвращает unknownIds.
const QUESTION_ID = /^(hist_flag|lang|open_outline_country|open_flag_country|open_capital|outline_country|flag_capital|flag_country|capital_fixed|capital)_[a-z0-9_-]{1,40}$/;

function isKnownQuestionId(id: unknown): id is string {
  return typeof id === 'string' && QUESTION_ID.test(id);
}

function questionIdCategory(id: unknown): CategoryId | null {
  if (!isKnownQuestionId(id)) return null;
  if (id.startsWith('hist_flag_')) return 'history';
  if (id.startsWith('lang_')) return 'languages';
  return 'geography';
}

export interface MistakeEntry {
  /** Question id, `{template}_{entity code}`: enough to rebuild the question. */
  id: string;
  category: CategoryId;
  /** How many mistakes are still owed: decreased by correct answers. */
  count: number;
  /** Epoch ms of the last mistake. */
  lastAt: number;
}

export const MAX_MISTAKES = 200;
export const TRAINING_SESSION_SIZE = 10;

// Device-local only: there is no server profile. Cleared storage means a clean list.
const KEY = 'clutch_mistakes_v1';

function isEntry(value: unknown): value is MistakeEntry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return typeof e.id === 'string'
    && (e.category === 'geography' || e.category === 'history' || e.category === 'languages')
    && typeof e.count === 'number' && Number.isInteger(e.count) && e.count >= 1
    && typeof e.lastAt === 'number' && Number.isFinite(e.lastAt);
}

// ---- pure list operations ----

export function addMistake(
  list: readonly MistakeEntry[],
  id: string,
  category: CategoryId,
  now: number,
): MistakeEntry[] {
  const existing = list.find((e) => e.id === id);
  let next: MistakeEntry[] = existing
    ? list.map((e) => (e.id === id ? { ...e, count: e.count + 1, lastAt: now } : e))
    : [...list, { id, category, count: 1, lastAt: now }];
  if (next.length > MAX_MISTAKES) {
    // Evict the entry whose last mistake is the oldest.
    const oldest = next.reduce((a, b) => (b.lastAt < a.lastAt ? b : a));
    next = next.filter((e) => e !== oldest);
  }
  return next;
}

export function addCorrect(list: readonly MistakeEntry[], id: string): MistakeEntry[] {
  return list
    .map((e) => (e.id === id ? { ...e, count: e.count - 1 } : e))
    .filter((e) => e.count > 0);
}

/** Most mistakes first; among equals the fresher mistake first. */
export function selectTrainingIds(
  list: readonly MistakeEntry[],
  limit: number = TRAINING_SESSION_SIZE,
): string[] {
  return [...list]
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
    .slice(0, limit)
    .map((e) => e.id);
}

// ---- storage ----

export function loadMistakes(): MistakeEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isEntry).slice(0, MAX_MISTAKES) : [];
  } catch {
    return [];
  }
}

function save(list: readonly MistakeEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // localStorage unavailable
  }
}

/** Records a wrong answer or a timeout. Ids that cannot be rebuilt are ignored. */
export function recordMistake(questionId: string, now: number = Date.now()): void {
  const category = questionIdCategory(questionId);
  if (!category) return;
  save(addMistake(loadMistakes(), questionId, category, now));
}

/** A correct answer lowers the counter; at zero the entry disappears. */
export function recordCorrectAnswer(questionId: string): void {
  const list = loadMistakes();
  if (!list.some((e) => e.id === questionId)) return;
  save(addCorrect(list, questionId));
}

/** Entries whose question still exists. Stale ids from older versions are not counted. */
export function loadPlayableMistakes(): MistakeEntry[] {
  return loadMistakes().filter((e) => isKnownQuestionId(e.id));
}

export function mistakeCount(): number {
  return loadPlayableMistakes().length;
}

/** Убирает записи, о которых сервер сказал, что вопрос из них больше не собрать (unknownIds). */
export function removeMistakes(ids: readonly string[]): void {
  if (ids.length === 0) return;
  const gone = new Set(ids);
  const all = loadMistakes();
  const kept = all.filter((e) => !gone.has(e.id));
  if (kept.length !== all.length) save(kept);
}

/** Drops entries whose question no longer exists, so they stop occupying the 200 slots. */
export function pruneUnknownMistakes(): void {
  const all = loadMistakes();
  const kept = all.filter((e) => isKnownQuestionId(e.id));
  if (kept.length !== all.length) save(kept);
}
