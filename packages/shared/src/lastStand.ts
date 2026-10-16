// Заморожено 2026-10-16: входа из интерфейса нет, код и тесты поддерживаются, новых функций не добавлять.
import { countries } from './countries';
import { createSeededRandom, dailyKey, hashSeed } from './dailyQuestionSet';

/**
 * Last Stand rules. Not a quiz: the contest is to not coincide with an opponent's answer.
 * Pure — no clock, no Math.random, no I/O. Narrow categories are passed in, never defined here.
 */

export type LastStandScale = 'wide' | 'regional' | 'narrow';

/** A category with a known membership. `members` are country codes (see countries.ts). */
export interface LastStandCategory {
  id: string;
  scale: LastStandScale;
  members: readonly string[];
}

/** Narrow categories hold 2..6 countries. */
export const NARROW_MIN_MEMBERS = 2;
export const NARROW_MAX_MEMBERS = 6;

/** A day is cleared after this many survived rounds. */
export const LAST_STAND_MAX_ROUNDS = 12;

/**
 * Player plus two opponent records. A category smaller than the table eliminates by arithmetic
 * instead of knowledge, so the planner skips those; they stay valid data for when a round can be
 * sized against the opponents still answering.
 */
export const LAST_STAND_TABLE_SIZE = 3;

/** Narrow share of rounds grows linearly from the first round to the last (a probability, not a ladder). */
export const NARROW_SHARE_FIRST = 0.1;
export const NARROW_SHARE_LAST = 0.75;
/** Among non-narrow rounds, probability that the round is wide (otherwise regional). */
export const WIDE_SHARE_OF_REST = 0.5;

/** Timer per scale, not per round number. */
export const LAST_STAND_TIMERS: Readonly<Record<LastStandScale, { baseMs: number; collisionBonusMs: number }>> = {
  wide: { baseMs: 15_000, collisionBonusMs: 7_000 },
  regional: { baseMs: 10_000, collisionBonusMs: 5_000 },
  narrow: { baseMs: 7_000, collisionBonusMs: 3_000 },
};

export interface LastStandRound {
  index: number;
  scale: LastStandScale;
  categoryId: string;
  members: readonly string[];
  baseTimeMs: number;
  collisionBonusMs: number;
}

export function baseTimeMs(scale: LastStandScale): number {
  return LAST_STAND_TIMERS[scale].baseMs;
}

export function collisionBonusMs(scale: LastStandScale): number {
  return LAST_STAND_TIMERS[scale].collisionBonusMs;
}

/** Round time limit (ms from round start) after the given number of collisions. */
export function roundDeadlineMs(
  round: Pick<LastStandRound, 'baseTimeMs' | 'collisionBonusMs'>,
  collisions: number,
): number {
  return round.baseTimeMs + Math.max(0, collisions) * round.collisionBonusMs;
}

/** Probability that round `index` (0-based) of `total` is narrow. */
export function narrowShareAt(index: number, total: number = LAST_STAND_MAX_ROUNDS): number {
  if (total <= 1) return NARROW_SHARE_LAST;
  const t = Math.min(1, Math.max(0, index / (total - 1)));
  return NARROW_SHARE_FIRST + (NARROW_SHARE_LAST - NARROW_SHARE_FIRST) * t;
}

/** The single wide category: every country in countries.ts. */
export function wideCategory(): LastStandCategory {
  return { id: 'world', scale: 'wide', members: countries.map((country) => country.code) };
}

/** One regional category per `region` value found in countries.ts, sorted by id. */
export function regionalCategories(): LastStandCategory[] {
  const byRegion = new Map<string, string[]>();
  for (const country of countries) {
    const list = byRegion.get(country.region) ?? [];
    list.push(country.code);
    byRegion.set(country.region, list);
  }
  return [...byRegion.entries()]
    .map(([region, members]) => ({ id: `region:${region}`, scale: 'regional' as const, members }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Throws RangeError unless every category is narrow, 2..6 unique members, with unique ids. */
export function validateNarrowCategories(narrow: readonly LastStandCategory[]): void {
  const ids = new Set<string>();
  for (const category of narrow) {
    if (category.scale !== 'narrow') throw new RangeError(`category ${category.id} is not narrow`);
    if (ids.has(category.id)) throw new RangeError(`duplicate narrow category id ${category.id}`);
    ids.add(category.id);
    const size = new Set(category.members).size;
    if (size !== category.members.length) throw new RangeError(`category ${category.id} has duplicate members`);
    if (size < NARROW_MIN_MEMBERS || size > NARROW_MAX_MEMBERS) {
      throw new RangeError(
        `narrow category ${category.id} must have ${NARROW_MIN_MEMBERS}..${NARROW_MAX_MEMBERS} members`,
      );
    }
  }
}

function toRound(index: number, category: LastStandCategory): LastStandRound {
  return {
    index,
    scale: category.scale,
    categoryId: category.id,
    members: [...category.members],
    baseTimeMs: baseTimeMs(category.scale),
    collisionBonusMs: collisionBonusMs(category.scale),
  };
}

/**
 * Plan of the day. Deterministic: same dateKey and pools give the same rounds.
 * `extraRegional` joins the regional pool next to the country regions (other category sources).
 * No category repeats while an unused one is left anywhere, and neighbours never share one.
 */
export function planLastStandRounds(
  dateKey: string,
  narrowCategories: readonly LastStandCategory[],
  total: number = LAST_STAND_MAX_ROUNDS,
  extraRegional: readonly LastStandCategory[] = [],
): LastStandRound[] {
  validateNarrowCategories(narrowCategories);
  const random = createSeededRandom(hashSeed(`last-stand:${dateKey}`));
  const pools: Record<LastStandScale, LastStandCategory[]> = {
    wide: [wideCategory()],
    regional: [...regionalCategories(), ...extraRegional.filter((category) => category.scale === 'regional')]
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    narrow: [...narrowCategories]
      .filter((category) => category.members.length >= LAST_STAND_TABLE_SIZE)
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
  const used = new Set<string>();
  const rounds: LastStandRound[] = [];
  for (let index = 0; index < total; index++) {
    const scaleDraw = random();
    const categoryDraw = random();
    const narrowShare = narrowShareAt(index, total);
    let scale: LastStandScale;
    if (scaleDraw < narrowShare) scale = 'narrow';
    else scale = (scaleDraw - narrowShare) / (1 - narrowShare) < WIDE_SHARE_OF_REST ? 'wide' : 'regional';
    if (scale === 'narrow' && pools.narrow.length === 0) scale = 'regional';
    const previousId = rounds.length > 0 ? rounds[rounds.length - 1].categoryId : null;
    // Two neighbouring rounds never share a category: same scale first, then the other scales.
    const pick = (candidateScale: LastStandScale, unusedOnly: boolean): LastStandCategory | null => {
      let pool = pools[candidateScale].filter((category) => category.id !== previousId);
      if (unusedOnly) pool = pool.filter((category) => !used.has(category.id));
      if (pool.length === 0) return null;
      return pool[Math.min(pool.length - 1, Math.floor(categoryDraw * pool.length))];
    };
    // A category repeats only once every category has been used: the wide scale holds a single
    // category, so preferring unused *within* a scale alone would bring "any country" back while
    // whole untouched regions were still waiting.
    const order: LastStandScale[] = [scale, ...(['regional', 'narrow', 'wide'] as const).filter((s) => s !== scale)];
    let category: LastStandCategory | null = null;
    for (const unusedOnly of [true, false]) {
      for (const candidateScale of order) {
        category = pick(candidateScale, unusedOnly);
        if (category !== null) break;
      }
      if (category !== null) break;
    }
    if (category === null) throw new RangeError('no category available for round');
    used.add(category.id);
    rounds.push(toRound(index, category));
  }
  return rounds;
}

/** Plan for the UTC day containing the timestamp. */
export function lastStandPlanForTimestamp(
  timestampMs: number,
  narrowCategories: readonly LastStandCategory[],
): LastStandRound[] {
  return planLastStandRounds(dailyKey(timestampMs), narrowCategories);
}

/** A previous player's recorded answer in a round. */
export interface RecordedAnswer {
  answer: string;
  /** Elapsed ms from round start when the record submitted it. */
  atMs: number;
}

/** Answers of the table's records for one round; null if a record had no answer in it. */
export type RecordAnswers = readonly (RecordedAnswer | null)[];

/**
 * Members not named by any opponent record of the round (time plays no role).
 * `mine` is the system's pre-set answer: naming it eliminates, so it is never a free option.
 */
export function freeOptions(members: readonly string[], records: RecordAnswers, mine: string | null = null): string[] {
  const taken = new Set<string>();
  for (const record of records) if (record) taken.add(record.answer);
  return members.filter((member) => !taken.has(member) && member !== mine);
}

/** Number of members no opponent named (and that are not the mine). */
export function countFreeOptions(members: readonly string[], records: RecordAnswers, mine: string | null = null): number {
  return freeOptions(members, records, mine).length;
}

/** True when opponents' answers and the mine cover every member: nothing safe is left to name. */
export function isExhausted(members: readonly string[], records: RecordAnswers, mine: string | null = null): boolean {
  return members.length > 0 && countFreeOptions(members, records, mine) === 0;
}

export type LastStandResolution =
  | { kind: 'accepted'; answer: string }
  /** Named by an opponent record in this round, whoever was faster: name something else; `deadlineMs` already includes the bonus. */
  | { kind: 'occupied'; answer: string; collisions: number; deadlineMs: number; freeLeft: number }
  /** Not recognised or not in the category: not an elimination, keep typing while the timer runs. */
  | { kind: 'invalid' }
  | { kind: 'eliminated'; reason: 'timeout' | 'exhausted' | 'mined' };

export interface ResolveInput {
  round: Pick<LastStandRound, 'members' | 'baseTimeMs' | 'collisionBonusMs'>;
  /** Country code the player submitted, or null for unrecognised input. */
  answer: string | null;
  /** Elapsed ms from round start at submission. */
  atMs: number;
  records: RecordAnswers;
  /** Collisions already suffered in this round. */
  collisions: number;
  /** The system's pre-set answer for the round (member id), or null when the round has none. */
  mine?: string | null;
}

/**
 * Resolves one submission, in order: exhausted, timeout, invalid, mined, occupied.
 * The mine kills even when an opponent record already holds the same answer.
 * Occupied ignores who was faster, so `atMs` only ever decides the timeout. Records never change.
 */
export function resolveLastStandAnswer(input: ResolveInput): LastStandResolution {
  const { round, answer, atMs, records, collisions } = input;
  const mine = input.mine ?? null;
  const deadline = roundDeadlineMs(round, collisions);
  if (isExhausted(round.members, records, mine)) return { kind: 'eliminated', reason: 'exhausted' };
  if (atMs > deadline) return { kind: 'eliminated', reason: 'timeout' };
  if (answer === null || !round.members.includes(answer)) return { kind: 'invalid' };
  if (mine !== null && answer === mine) return { kind: 'eliminated', reason: 'mined' };
  const blocked = records.some((record) => record && record.answer === answer);
  if (!blocked) return { kind: 'accepted', answer };
  const next = collisions + 1;
  return {
    kind: 'occupied',
    answer,
    collisions: next,
    deadlineMs: roundDeadlineMs(round, next),
    freeLeft: countFreeOptions(round.members, records, mine),
  };
}

export type LastStandStatus = 'playing' | 'eliminated' | 'cleared';

export interface LastStandState {
  dateKey: string;
  rounds: readonly LastStandRound[];
  /** Index of the current round; equals survived while playing. */
  roundIndex: number;
  /** Score: rounds survived. */
  survived: number;
  /** Collisions in the current round. */
  collisions: number;
  status: LastStandStatus;
  eliminatedBy: 'timeout' | 'exhausted' | 'mined' | null;
}

export function createLastStandGame(
  dateKey: string,
  narrowCategories: readonly LastStandCategory[],
  total: number = LAST_STAND_MAX_ROUNDS,
): LastStandState {
  return {
    dateKey,
    rounds: planLastStandRounds(dateKey, narrowCategories, total),
    roundIndex: 0,
    survived: 0,
    collisions: 0,
    status: 'playing',
    eliminatedBy: null,
  };
}

export function isLastStandOver(state: LastStandState): boolean {
  return state.status !== 'playing';
}

/** Current round, or null once the game is over. */
export function currentLastStandRound(state: LastStandState): LastStandRound | null {
  return state.status === 'playing' ? (state.rounds[state.roundIndex] ?? null) : null;
}

/** Applies a resolution. Terminal states are returned unchanged; input is never mutated. */
export function applyLastStandResolution(state: LastStandState, resolution: LastStandResolution): LastStandState {
  if (state.status !== 'playing') return state;
  switch (resolution.kind) {
    case 'invalid':
      return state;
    case 'occupied':
      return { ...state, collisions: resolution.collisions };
    case 'eliminated':
      return { ...state, status: 'eliminated', eliminatedBy: resolution.reason };
    case 'accepted': {
      const survived = state.survived + 1;
      const cleared = survived >= state.rounds.length;
      return {
        ...state,
        survived,
        roundIndex: state.roundIndex + 1,
        collisions: 0,
        status: cleared ? 'cleared' : 'playing',
      };
    }
  }
}

/** Resolves a submission against the current round and advances the state. */
export function submitLastStandAnswer(
  state: LastStandState,
  submission: { answer: string | null; atMs: number; records: RecordAnswers; mine?: string | null },
): { state: LastStandState; resolution: LastStandResolution | null } {
  const round = currentLastStandRound(state);
  if (!round) return { state, resolution: null };
  const resolution = resolveLastStandAnswer({ round, ...submission, collisions: state.collisions });
  return { state: applyLastStandResolution(state, resolution), resolution };
}
