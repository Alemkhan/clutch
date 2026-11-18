import { describe, expect, it } from 'vitest';
import {
  achievementsOf,
  experienceOf,
  gameDayNumber,
  levelFromXp,
  streakFromDays,
  xpForLevel,
  type PlayerStats,
} from './progress';

const empty: PlayerStats = {
  completedRuns: 0,
  reachedTargetRuns: 0,
  bestRounds: null,
  correctAnswers: 0,
  duelWins: 0,
  tiebreakerAnswers: 0,
  wikiPathsCompleted: 0,
  friendChallenges: 0,
  bestStreak: 0,
};

describe('streak', () => {
  it('counts days in a row ending today', () => {
    expect(streakFromDays(['2026-11-14', '2026-11-15', '2026-11-16'], '2026-11-16')).toEqual({ current: 3, best: 3, playedToday: true });
  });

  it('keeps the streak from yesterday alive until today ends', () => {
    expect(streakFromDays(['2026-11-14', '2026-11-15'], '2026-11-16')).toEqual({ current: 2, best: 2, playedToday: false });
  });

  it('drops to zero after a missed day but remembers the best run', () => {
    expect(streakFromDays(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-14'], '2026-11-16'))
      .toEqual({ current: 0, best: 4, playedToday: false });
  });

  it('ignores duplicates, order, and days after today', () => {
    expect(streakFromDays(['2026-11-16', '2026-11-15', '2026-11-16', '2026-11-17'], '2026-11-16'))
      .toEqual({ current: 2, best: 2, playedToday: true });
  });

  it('crosses a month boundary', () => {
    expect(streakFromDays(['2026-10-31', '2026-11-01'], '2026-11-01').current).toBe(2);
  });
});

describe('levels', () => {
  it('starts at level 1 and gets 50 XP pricier per level', () => {
    expect(levelFromXp(0)).toEqual({ level: 1, xpIntoLevel: 0, xpForLevel: 100, totalXp: 0 });
    expect(levelFromXp(99).level).toBe(1);
    expect(levelFromXp(100)).toEqual({ level: 2, xpIntoLevel: 0, xpForLevel: 150, totalXp: 100 });
    expect(levelFromXp(100 + 150 + 30)).toMatchObject({ level: 3, xpIntoLevel: 30 });
    expect(xpForLevel(10)).toBe(550);
  });

  it('earns XP for correct answers, finishes and daily modes', () => {
    expect(experienceOf({ ...empty, correctAnswers: 12, reachedTargetRuns: 1, tiebreakerAnswers: 2, wikiPathsCompleted: 1 }))
      .toBe(120 + 25 + 30 + 20);
  });
});

describe('achievements', () => {
  it('are all locked for a new player and unlock at their goal', () => {
    expect(achievementsOf(empty).every((achievement) => !achievement.unlocked)).toBe(true);
    const unlocked = achievementsOf({ ...empty, completedRuns: 10, reachedTargetRuns: 1, bestRounds: 9, bestStreak: 7 })
      .filter((achievement) => achievement.unlocked)
      .map((achievement) => achievement.id);
    expect(unlocked).toEqual(['first_run', 'first_finish', 'fast_finish', 'streak_3', 'streak_7', 'runs_10']);
  });

  it('caps the shown progress at the goal', () => {
    const correct = achievementsOf({ ...empty, correctAnswers: 140 }).find((achievement) => achievement.id === 'correct_100');
    expect(correct).toMatchObject({ value: 100, goal: 100, unlocked: true });
  });
});

describe('game day number', () => {
  it('matches the «На глазок» numbering', () => {
    expect(gameDayNumber('2026-10-19')).toBe(1);
    expect(gameDayNumber('2026-11-14')).toBe(27);
  });
});
