import { SKILL_REWARDS, type Opponent, type PracticeLevelId, type Question } from '@clutch/shared';

export interface BotProfile {
  id: string;
  displayName: string;
  rewards: readonly number[];
  responseTimeMs: (roundIndex: number) => number;
}

const botResponseTimeMs = (roundIndex: number) => 2400 + (roundIndex % 4) * 500;

// Награды заданы на 20 кругов (потолок забега) и НЕ повторяются: набор из 18 вопросов
// берёт первые 18, и подписи уровней от длины набора (18 или 20) не зависят.
// Круг, на котором бот набирает 100%: Alex 6, Ira 9, Max 13, Dana 17. Ступени 3-4 круга.

// Мастер: 100% на 6-м круге (после 5-го 98%).
export const DEFAULT_BOT_PROFILE: BotProfile = {
  id: 'clutch_bot',
  displayName: 'Alex',
  rewards: [18, 25, 12, 18, 25, 12, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18],
  responseTimeMs: botResponseTimeMs,
};

// Новичок: 100% на 17-м круге (после 16-го 95%).
export const WEAK_BOT_PROFILE: BotProfile = {
  id: 'clutch_bot_weak',
  displayName: 'Dana',
  rewards: [5, 12, 0, 5, 0, 12, 5, 0, 12, 5, 0, 12, 5, 5, 12, 5, 12, 0, 5, 5],
  responseTimeMs: botResponseTimeMs,
};

// Любитель: 100% на 13-м круге (после 12-го 93%).
export const MEDIUM_BOT_PROFILE: BotProfile = {
  id: 'clutch_bot_medium',
  displayName: 'Max',
  rewards: [12, 18, 0, 12, 5, 12, 0, 12, 12, 5, 0, 5, 12, 12, 12, 12, 12, 12, 12, 12],
  responseTimeMs: botResponseTimeMs,
};

// Опытный: 100% на 9-м круге (после 8-го 97%).
export const STRONG_BOT_PROFILE: BotProfile = {
  id: 'clutch_bot_strong',
  displayName: 'Ira',
  rewards: [18, 12, 0, 25, 12, 18, 0, 12, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18],
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
