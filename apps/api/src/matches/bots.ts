import { SKILL_REWARDS, type Opponent, type Question } from '@clutch/shared';

export interface BotProfile {
  id: string;
  displayName: string;
  rewards: readonly number[];
  responseTimeMs: (roundIndex: number) => number;
}

export const DEFAULT_BOT_PROFILE: BotProfile = {
  id: 'clutch_bot',
  displayName: 'Alex',
  rewards: [18, 12, 0, 25, 18, 0, 18, 12, 25, 18],
  responseTimeMs: (roundIndex) => 2400 + (roundIndex % 4) * 500,
};

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
