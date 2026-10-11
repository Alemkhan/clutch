import { SKILL_REWARDS, type Opponent, type PracticeLevelId, type Question } from '@clutch/shared';

export interface BotProfile {
  id: string;
  displayName: string;
  rewards: readonly number[];
  responseTimeMs: (roundIndex: number) => number;
}

const botResponseTimeMs = (roundIndex: number) => 2400 + (roundIndex % 4) * 500;

// Сильный: 100% на 8-м раунде. Это прежняя кривая Alex, она не менялась.
export const DEFAULT_BOT_PROFILE: BotProfile = {
  id: 'clutch_bot',
  displayName: 'Alex',
  rewards: [18, 12, 0, 25, 18, 0, 18, 12, 25, 18],
  responseTimeMs: botResponseTimeMs,
};

// Слабый: итог 64% за 10 раундов, 100% не достигает.
export const WEAK_BOT_PROFILE: BotProfile = {
  id: 'clutch_bot_weak',
  displayName: 'Dana',
  rewards: [12, 5, 0, 12, 0, 18, 0, 12, 0, 5],
  responseTimeMs: botResponseTimeMs,
};

// Средний: 100% ровно на 10-м раунде (после 9-го 95%).
export const MEDIUM_BOT_PROFILE: BotProfile = {
  id: 'clutch_bot_medium',
  displayName: 'Max',
  rewards: [18, 12, 0, 18, 12, 18, 0, 12, 5, 25],
  responseTimeMs: botResponseTimeMs,
};

// Крепкий: 100% на 9-м раунде (после 8-го 97%).
export const STRONG_BOT_PROFILE: BotProfile = {
  id: 'clutch_bot_strong',
  displayName: 'Ira',
  rewards: [18, 12, 0, 25, 12, 0, 18, 12, 18, 18],
  responseTimeMs: botResponseTimeMs,
};

// Порядок и доли (в процентах): слабый 40, средний 30, крепкий 20, сильный 10.
const BOT_PROFILE_WEIGHTS: ReadonlyArray<readonly [BotProfile, number]> = [
  [WEAK_BOT_PROFILE, 40],
  [MEDIUM_BOT_PROFILE, 30],
  [STRONG_BOT_PROFILE, 20],
  [DEFAULT_BOT_PROFILE, 10],
];

export const BOT_PROFILES: readonly BotProfile[] = BOT_PROFILE_WEIGHTS.map(([profile]) => profile);

// FNV-1a 32 бита от `${questionSetId}:${playerId}`, затем остаток от деления на 100.
export function pickBotProfile(questionSetId: string, playerId: string): BotProfile {
  const text = `${questionSetId}:${playerId}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // финальное перемешивание, чтобы младшие биты не зависели от последних символов
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x2c1b3c6d) >>> 0;
  hash ^= hash >>> 12;
  let bucket = (hash >>> 0) % 100;
  for (const [profile, weight] of BOT_PROFILE_WEIGHTS) {
    if (bucket < weight) return profile;
    bucket -= weight;
  }
  return DEFAULT_BOT_PROFILE;
}

export function createBotOpponent(
  questions: readonly Question[],
  profile: BotProfile = DEFAULT_BOT_PROFILE,
): Opponent {
  if (!profile.id || !profile.displayName || profile.rewards.length === 0) {
    throw new Error('Bot profile must have an id, display name, and rewards.');
  }

  const supportedRewards = new Set<number>(Object.values(SKILL_REWARDS));
  let progress = 0;
  const rounds = [];
  for (let index = 0; index < questions.length && progress < 100; index += 1) {
    const question = questions[index];
    const progressAwarded = profile.rewards[index % profile.rewards.length];
    const responseTimeMs = profile.responseTimeMs(index);
    if (!supportedRewards.has(progressAwarded)
      || !Number.isFinite(responseTimeMs) || responseTimeMs < 0) {
      throw new Error('Bot profile contains an invalid reward or response time.');
    }
    progress = Math.min(100, progress + progressAwarded);
    rounds.push({
      questionId: question.id,
      correct: progressAwarded > 0,
      responseTimeMs,
      skillScore: progressAwarded / 25,
      progressAwarded,
    });
  }
  return { id: profile.id, displayName: profile.displayName, rounds };
}

/** Уровни тренировки — это существующие профили, новых нет. Подписи уровней проверяются тестом. */
export const PRACTICE_BOT_PROFILES: Readonly<Record<PracticeLevelId, BotProfile>> = {
  novice: WEAK_BOT_PROFILE,
  amateur: MEDIUM_BOT_PROFILE,
  skilled: STRONG_BOT_PROFILE,
  master: DEFAULT_BOT_PROFILE,
};
