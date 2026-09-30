import { describe, expect, it } from 'vitest';
import {
  CURRENT_ASYNC_MATCH_CONDITIONS,
  hammerAttemptRules,
  hammerTargetCenter,
  hammerThresholdsForStage,
  normalizedHammerDistance,
  pressureStageFromResults,
  scoreHammerDistance,
  stableQuestionHash,
  type PressureStage,
} from './index';

const config = CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.config;

describe('hammer pressure rules', () => {
  it('advances on every non-miss result, ignores misses, and caps at stage three', () => {
    expect(pressureStageFromResults([])).toBe(0);
    expect(pressureStageFromResults(['miss'])).toBe(0);
    expect(pressureStageFromResults(['weak', 'miss'])).toBe(1);
    expect(pressureStageFromResults(['weak', 'good', 'great'])).toBe(3);
    expect(pressureStageFromResults(['perfect', 'weak', 'good', 'great', 'perfect'])).toBe(3);
  });

  it.each([0, 1, 2, 3] as PressureStage[])(
    'uses exact inclusive tier boundaries at stage %s',
    (stage) => {
      const thresholds = hammerThresholdsForStage(stage, config);
      expect(scoreHammerDistance(thresholds.perfect, stage, config).result).toBe('perfect');
      expect(scoreHammerDistance(thresholds.perfect + 1e-9, stage, config).result).toBe('great');
      expect(scoreHammerDistance(thresholds.great, stage, config).result).toBe('great');
      expect(scoreHammerDistance(thresholds.great + 1e-9, stage, config).result).toBe('good');
      expect(scoreHammerDistance(thresholds.good, stage, config).result).toBe('good');
      expect(scoreHammerDistance(thresholds.good + 1e-9, stage, config).result).toBe('weak');
      expect(scoreHammerDistance(thresholds.weak, stage, config).result).toBe('weak');
      expect(scoreHammerDistance(thresholds.weak + 1e-9, stage, config).result).toBe('miss');
    },
  );

  it('applies the exact stage multipliers', () => {
    expect(([0, 1, 2, 3] as PressureStage[]).map(
      (stage) => hammerThresholdsForStage(stage, config).weak,
    )).toEqual([0.85, 0.85 * 0.9, 0.85 * 0.8, 0.85 * 0.7]);
  });

  it('derives a stable, varied target and keeps the widest zone on the track', () => {
    expect(stableQuestionHash('question-alpha')).toBe(1_699_041_916);
    const first = hammerTargetCenter('question-alpha', 3, config);
    expect(hammerTargetCenter('question-alpha', 3, config)).toBe(first);
    expect(hammerTargetCenter('question-beta', 3, config)).not.toBe(first);

    for (const stage of [0, 1, 2, 3] as PressureStage[]) {
      for (const questionId of ['question-alpha', 'question-beta', 'z']) {
        const attempt = hammerAttemptRules(questionId, Array(stage).fill('great'), config);
        expect(attempt.targetCenter - attempt.thresholds.weak / 2).toBeGreaterThanOrEqual(0);
        expect(attempt.targetCenter + attempt.thresholds.weak / 2).toBeLessThanOrEqual(1);
      }
    }
  });

  it('normalizes around the shifted target and clamps to one', () => {
    expect(normalizedHammerDistance(0.62, 0.62)).toBe(0);
    expect(normalizedHammerDistance(0.52, 0.62)).toBeCloseTo(0.2);
    expect(normalizedHammerDistance(0.72, 0.62)).toBeCloseTo(0.2);
    expect(normalizedHammerDistance(-5, 0.62)).toBe(1);
    expect(normalizedHammerDistance(5, 0.62)).toBe(1);
  });
});
