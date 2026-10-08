import { generateMatch, type CategoryId, type TemplateUsage } from './questionGenerator';
import type { Question } from './index';

export const DAILY_SET_SIZE = 10;
export const DAILY_SET_OPEN_RATIO = 0.3;
/** How many different question sets exist per category per UTC day. */
export const DAILY_BANK_SIZE = 12;

/** Small deterministic PRNG (mulberry32): same seed, same sequence. Returns floats in [0, 1). */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit FNV-1a hash of a string, used to turn a set id into a PRNG seed. */
export function hashSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** UTC calendar day as YYYY-MM-DD. The daily set rolls over at 00:00 UTC. */
export function dailyKey(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

/** Identifier of a set in the day's bank, for example `geography:2026-10-07:5`. */
export function questionSetId(category: CategoryId, dateKey: string, index: number): string {
  return `${category}:${dateKey}:${index}`;
}

/** All set ids of the category's bank for the UTC day containing the timestamp, in index order. */
export function dailyQuestionSetIds(category: CategoryId, timestampMs: number = Date.now()): string[] {
  const dateKey = dailyKey(timestampMs);
  return Array.from({ length: DAILY_BANK_SIZE }, (_, index) => questionSetId(category, dateKey, index));
}

type DailySet = { questionSetId: string; questions: Question[] };

/** Only a few recent days/categories are kept: a long-lived isolate must not grow without bound. */
const BANK_CACHE_LIMIT = 6;
const bankCache = new Map<string, readonly DailySet[]>();

function buildDailyBank(category: CategoryId, dateKey: string): DailySet[] {
  // One pass over the whole bank. The usage ledger records which templates each entity was
  // already asked with today, so a repeated entity is asked in a different format.
  const usage: TemplateUsage = new Map();
  // createdAt is wall-clock in the generator; pin it so the set is byte-identical for everyone.
  const createdAt = `${dateKey}T00:00:00.000Z`;
  return Array.from({ length: DAILY_BANK_SIZE }, (_, index) => {
    const id = questionSetId(category, dateKey, index);
    const questions = generateMatch(
      DAILY_SET_SIZE,
      DAILY_SET_OPEN_RATIO,
      category,
      createSeededRandom(hashSeed(id)),
      usage,
    );
    return { questionSetId: id, questions: questions.map((question) => ({ ...question, createdAt })) };
  });
}

/** The whole bank for the category's UTC day, built once and memoized. Treat as read-only. */
export function dailyQuestionBank(category: CategoryId, timestampMs: number = Date.now()): readonly DailySet[] {
  const dateKey = dailyKey(timestampMs);
  const key = `${category}:${dateKey}`;
  const cached = bankCache.get(key);
  if (cached) return cached;
  const bank = buildDailyBank(category, dateKey);
  bankCache.set(key, bank);
  while (bankCache.size > BANK_CACHE_LIMIT) {
    const oldest = bankCache.keys().next().value;
    if (oldest === undefined) break;
    bankCache.delete(oldest);
  }
  return bank;
}

/** Number of memoized banks (for tests). */
export function dailyBankCacheSize(): number {
  return bankCache.size;
}

/** Drops memoized banks (for tests). */
export function clearDailyBankCache(): void {
  bankCache.clear();
}

/** One deterministic set of the day's bank. Pure: no network or storage. Returns a fresh copy. */
export function dailyQuestionSet(
  category: CategoryId,
  timestampMs: number = Date.now(),
  index = 0,
): DailySet {
  if (!Number.isInteger(index) || index < 0 || index >= DAILY_BANK_SIZE) {
    throw new RangeError(`bank index must be an integer in [0, ${DAILY_BANK_SIZE})`);
  }
  return structuredClone(dailyQuestionBank(category, timestampMs)[index]) as DailySet;
}
