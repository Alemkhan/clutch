import { generateMatch } from '@clutch/shared';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOT_PROFILE,
  createBotOpponent,
  type BotProfile,
} from '../apps/api/src/matches/bots';

describe('createBotOpponent', () => {
  it('preserves the current Alex pattern and stops at the first 100 progress', () => {
    const questions = generateMatch(10, 0.3, 'geography');
    const opponent = createBotOpponent(questions);

    expect(DEFAULT_BOT_PROFILE.rewards).toEqual([18, 12, 0, 25, 18, 0, 18, 12, 25, 18]);
    expect(opponent.id).toBe('clutch_bot');
    expect(opponent.displayName).toBe('Alex');
    expect(opponent.rounds.map((round) => round.progressAwarded))
      .toEqual([18, 12, 0, 25, 18, 0, 18, 12]);
    expect(opponent.rounds.map((round) => round.responseTimeMs))
      .toEqual([2400, 2900, 3400, 3900, 2400, 2900, 3400, 3900]);
    expect(opponent.rounds.map((round) => round.questionId))
      .toEqual(questions.slice(0, 8).map((question) => question.id));
  });

  it('maps a custom profile onto question ids without changing the API shape', () => {
    const questions = generateMatch(3, 0, 'languages');
    const profile: BotProfile = {
      id: 'test_bot',
      displayName: 'Test',
      rewards: [12, 0],
      responseTimeMs: (index) => 1000 + index,
    };

    expect(createBotOpponent(questions, profile)).toEqual({
      id: 'test_bot',
      displayName: 'Test',
      rounds: [
        { questionId: questions[0].id, correct: true, responseTimeMs: 1000, skillScore: 0.48, progressAwarded: 12 },
        { questionId: questions[1].id, correct: false, responseTimeMs: 1001, skillScore: 0, progressAwarded: 0 },
        { questionId: questions[2].id, correct: true, responseTimeMs: 1002, skillScore: 0.48, progressAwarded: 12 },
      ],
    });
  });

  it('rejects unusable profiles and unsupported rewards', () => {
    expect(() => createBotOpponent([], { ...DEFAULT_BOT_PROFILE, rewards: [] }))
      .toThrow('Bot profile must have an id, display name, and rewards.');
    const questions = generateMatch(1, 0, 'history');
    expect(() => createBotOpponent(questions, { ...DEFAULT_BOT_PROFILE, rewards: [13] }))
      .toThrow('Bot profile contains an invalid reward or response time.');
  });
});
