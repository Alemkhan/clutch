import { SKILL_REWARDS, generateMatch } from '@clutch/shared';
import { describe, expect, it } from 'vitest';
import {
  BOT_PROFILES,
  DEFAULT_BOT_PROFILE,
  MEDIUM_BOT_PROFILE,
  STRONG_BOT_PROFILE,
  WEAK_BOT_PROFILE,
  createBotOpponent,
  pickBotProfile,
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

describe('bot profile selection', () => {
  const cumulative = (rewards: readonly number[]) => {
    let sum = 0;
    return rewards.map((reward) => Math.min(100, (sum += reward)));
  };
  const reachedAt = (profile: BotProfile) =>
    cumulative(profile.rewards).findIndex((value) => value >= 100) + 1;
  const supported = new Set<number>(Object.values(SKILL_REWARDS));

  it('defines four curves with the agreed 100% round', () => {
    expect(cumulative(WEAK_BOT_PROFILE.rewards)).toEqual([12, 17, 17, 29, 29, 47, 47, 59, 59, 64]);
    expect(reachedAt(WEAK_BOT_PROFILE)).toBe(0);
    expect(reachedAt(MEDIUM_BOT_PROFILE)).toBe(10);
    expect(reachedAt(STRONG_BOT_PROFILE)).toBe(9);
    expect(reachedAt(DEFAULT_BOT_PROFILE)).toBe(8);
    expect(new Set(BOT_PROFILES.map((p) => p.displayName)).size).toBe(4);
    expect(new Set(BOT_PROFILES.map((p) => p.id)).size).toBe(4);
  });

  it('uses only supported rewards and builds through createBotOpponent', () => {
    const questions = generateMatch(10, 0, 'history');
    for (const profile of BOT_PROFILES) {
      expect(profile.rewards).toHaveLength(10);
      for (const reward of profile.rewards) expect(supported.has(reward)).toBe(true);
      expect(() => createBotOpponent(questions, profile)).not.toThrow();
    }
    const weak = createBotOpponent(questions, WEAK_BOT_PROFILE);
    expect(weak.rounds).toHaveLength(10);
    const total = weak.rounds.reduce((sum, round) => sum + round.progressAwarded, 0);
    expect(total).toBeGreaterThanOrEqual(60);
    expect(total).toBeLessThanOrEqual(70);
  });

  it('is deterministic per set and player, and varies between sets', () => {
    expect(pickBotProfile('set-a', 'player-1')).toBe(pickBotProfile('set-a', 'player-1'));
    const picked = new Set<string>();
    for (let i = 0; i < 40; i += 1) picked.add(pickBotProfile(`set-${i}`, 'player-1').id);
    expect(picked.size).toBeGreaterThan(1);
  });

  it('approximates the 40/30/20/10 distribution', () => {
    const counts = new Map<string, number>();
    const total = 20000;
    for (let i = 0; i < total; i += 1) {
      const id = pickBotProfile(`geography:2026-10-08:${i}`, `player-${i % 37}`).id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const share = (profile: BotProfile) => (counts.get(profile.id) ?? 0) / total;
    expect(Math.abs(share(WEAK_BOT_PROFILE) - 0.4)).toBeLessThan(0.03);
    expect(Math.abs(share(MEDIUM_BOT_PROFILE) - 0.3)).toBeLessThan(0.03);
    expect(Math.abs(share(STRONG_BOT_PROFILE) - 0.2)).toBeLessThan(0.03);
    expect(Math.abs(share(DEFAULT_BOT_PROFILE) - 0.1)).toBeLessThan(0.03);
  });
});
