import {
  createSeededRandom,
  hashSeed,
  LAST_STAND_MAX_ROUNDS,
  type LastStandRound,
  type RecordedAnswer,
} from '@clutch/shared';

export interface LastStandOpponent {
  /** Run id of a real player's record, or `bot:<profile id>`. */
  runId: string;
  displayName: string;
  source: 'player' | 'bot';
  /** One slot per round; null when the record had no answer in it. */
  answers: (RecordedAnswer | null)[];
}

interface LastStandBotProfile {
  id: string;
  displayName: string;
  /** Picks a member index in the list ordered from most to least obvious. */
  pickIndex(random: () => number, size: number): number;
  /** Elapsed ms for the answer; always below the round's base timer. */
  answerMs(random: () => number, round: LastStandRound): number;
}

/** Roughly from the most obvious country to the least; anything unlisted ranks after these. */
const OBVIOUSNESS = [
  'us', 'ru', 'cn', 'de', 'fr', 'gb', 'it', 'es', 'jp', 'br', 'ca', 'in', 'au', 'mx', 'tr', 'ua',
  'pl', 'kr', 'eg', 'ar', 'se', 'nl', 'kz', 'sa', 'za', 'ir', 'gr', 'pt', 'ch', 'no', 'be', 'at',
  'fi', 'dk', 'cu', 'th', 'vn', 'id', 'pk', 'ng', 'cl', 'co', 'pe', 'il', 'cz', 'hu', 'by', 'ie',
  'nz', 'ke', 'ma', 'dz', 'et', 'kp', 'sg', 'my', 'ph', 'sk', 'ro', 'bg', 'rs', 'hr',
];
const obviousRank = new Map(OBVIOUSNESS.map((code, index) => [code, index]));

/** Fast bot: names the most obvious country within about 1.4-3.6 s. */
export const FAST_BOT: LastStandBotProfile = {
  id: 'ls_fast',
  displayName: 'Dana',
  pickIndex: () => 0,
  answerMs: (random) => Math.round(1400 + random() * 2200),
};

/** Slow bot: usually a less obvious country, at 45-80% of the round's base timer. */
export const SLOW_BOT: LastStandBotProfile = {
  id: 'ls_slow',
  displayName: 'Max',
  pickIndex: (random, size) => {
    if (size <= 1) return 0;
    if (random() < 0.3) return 0;
    return 1 + Math.floor(random() * Math.min(3, size - 1));
  },
  answerMs: (random, round) => Math.round(round.baseTimeMs * (0.45 + random() * 0.35)),
};

export const LAST_STAND_BOT_PROFILES: readonly LastStandBotProfile[] = [FAST_BOT, SLOW_BOT];

/** Members from the most obvious to the least; bots and the mine draw from the same order. */
export function orderedMembers(round: Pick<LastStandRound, 'categoryId' | 'members'>, dateKey: string): string[] {
  // A pack category lists its members from the most obvious to the least: keep that order.
  if (round.categoryId.startsWith('gp:')) return [...round.members];
  const members = round.members;
  const tieBreak = (code: string) => hashSeed(`ls-order:${dateKey}:${code}`);
  return [...members].sort((a, b) => {
    const ra = obviousRank.get(a) ?? Infinity;
    const rb = obviousRank.get(b) ?? Infinity;
    if (ra !== rb) return ra < rb ? -1 : 1;
    return tieBreak(a) - tieBreak(b);
  });
}

/** The mine is one of this many most obvious members. */
export const MINE_POOL_SIZE = 3;

/**
 * The system's pre-set answer for a round: one of the most obvious members, fixed by (dateKey, round).
 * Server only — never put it into a LastStandRound or a client payload.
 */
export function mineForRound(
  round: Pick<LastStandRound, 'index' | 'categoryId' | 'members'>,
  dateKey: string,
): string | null {
  const top = orderedMembers(round, dateKey).slice(0, MINE_POOL_SIZE);
  if (top.length === 0) return null;
  const random = createSeededRandom(hashSeed(`ls-mine:${dateKey}:${round.index}`));
  return top[Math.min(top.length - 1, Math.floor(random() * top.length))];
}

/**
 * A bot's recorded run: an answer with a time in every round, valid for the round's members.
 * Deterministic in (profile, dateKey, playerId).
 */
export function createLastStandBot(
  profile: LastStandBotProfile,
  dateKey: string,
  playerId: string,
  rounds: readonly LastStandRound[],
): LastStandOpponent {
  const random = createSeededRandom(hashSeed(`ls-bot:${profile.id}:${dateKey}:${playerId}`));
  const answers = rounds.slice(0, LAST_STAND_MAX_ROUNDS).map((round) => {
    // Records belong to players who survived, so a bot never names the mine.
    const mine = mineForRound(round, dateKey);
    const ordered = orderedMembers(round, dateKey).filter((member) => member !== mine);
    // Exactly two draws per round keep later rounds independent of earlier branching.
    const pickDraw = random();
    const timeDraw = random();
    const pickRandom = createSeededRandom(Math.floor(pickDraw * 4294967296));
    const index = Math.max(0, Math.min(ordered.length - 1, profile.pickIndex(pickRandom, ordered.length)));
    const atMs = profile.answerMs(() => timeDraw, round);
    return { answer: ordered[index], atMs: Math.min(atMs, round.baseTimeMs - 1) };
  });
  return { runId: `bot:${profile.id}`, displayName: profile.displayName, source: 'bot', answers };
}

/** Bots to fill `missing` seats; with one seat the profile is picked from (dateKey, playerId). */
export function pickFillerBots(
  missing: number,
  dateKey: string,
  playerId: string,
  rounds: readonly LastStandRound[],
): LastStandOpponent[] {
  if (missing <= 0) return [];
  const profiles = missing >= LAST_STAND_BOT_PROFILES.length
    ? LAST_STAND_BOT_PROFILES
    : [LAST_STAND_BOT_PROFILES[hashSeed(`ls-pick:${dateKey}:${playerId}`) % LAST_STAND_BOT_PROFILES.length]];
  return profiles.map((profile) => createLastStandBot(profile, dateKey, playerId, rounds));
}
