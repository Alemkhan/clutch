import { describe, expect, it } from 'vitest';
import {
  CURRENT_HAMMER_MINI_GAME,
  LEGACY_HAMMER_MINI_GAME_CONFIG,
  supportedMiniGameConfig,
  SKILL_DISTANCE_THRESHOLDS,
  dailyQuestionBank,
  hammerAttemptRules,
  hammerMarkerSpeed,
  hammerTargetCenter,
  hammerThresholdsForStage,
  markerPositionAtElapsed,
  normalizedHammerDistance,
  pressureStageFromResults,
  scoreHammerDistance,
  scoreHammerTap,
  stableQuestionHash,
  type PressureStage,
} from '../index';

const config = CURRENT_HAMMER_MINI_GAME.config;

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

  it('keeps mirrored points on every tier boundary equal at real targets and all stages', () => {
    for (const stage of [0, 1, 2, 3] as PressureStage[]) {
      const thresholds = hammerThresholdsForStage(stage, config);
      const targetCenters = ['question-alpha', 'question-beta', 'z']
        .map((questionId) => hammerTargetCenter(questionId, stage, config));
      for (const center of targetCenters) {
        for (const boundary of Object.values(thresholds)) {
          const offset = boundary / 2;
          const leftDistance = normalizedHammerDistance(center - offset, center);
          const rightDistance = normalizedHammerDistance(center + offset, center);
          expect(leftDistance).toBeCloseTo(rightDistance, 12);
          expect(scoreHammerDistance(leftDistance, stage, config).result)
            .toBe(scoreHammerDistance(rightDistance, stage, config).result);
        }
      }
    }
  });

  it('preserves the .12 inclusive boundary without widening tiers perceptibly', () => {
    const center = 0.45;
    const boundary = 0.12;
    const mirroredDistances = [center - boundary / 2, center + boundary / 2]
      .map((position) => normalizedHammerDistance(position, center));
    expect(mirroredDistances.map((distance) => scoreHammerDistance(distance, 0, config).result))
      .toEqual(['great', 'great']);

    for (const sign of [-1, 1]) {
      const justOutside = normalizedHammerDistance(center + sign * (boundary + 1e-9) / 2, center);
      expect(scoreHammerDistance(justOutside, 0, config).result).toBe('good');
    }
  });

  it('applies the exact stage multipliers', () => {
    expect(([0, 1, 2, 3] as PressureStage[]).map(
      (stage) => hammerThresholdsForStage(stage, config).weak,
    )).toEqual([0.55, 0.55 * 0.85, 0.55 * 0.72, 0.55 * 0.6]);
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

  it('keeps the configured perfect width equal to the scored perfect threshold', () => {
    expect(config.perfectWidth).toBe(SKILL_DISTANCE_THRESHOLDS.perfect);
    expect(config.targetWidth).toBe(SKILL_DISTANCE_THRESHOLDS.weak);
    expect(hammerThresholdsForStage(0, config).perfect).toBe(config.perfectWidth);
  });
});

describe('hammer marker speed', () => {
  it('is deterministic per question id and stage', () => {
    for (const stage of [0, 1, 2, 3] as PressureStage[]) {
      const first = hammerMarkerSpeed('question-alpha', stage, config);
      expect(hammerMarkerSpeed('question-alpha', stage, config)).toBe(first);
      expect(hammerAttemptRules('question-alpha', Array(stage).fill('great'), config).markerSpeed).toBe(first);
    }
    expect(hammerMarkerSpeed('question-alpha', 0, config))
      .not.toBe(hammerMarkerSpeed('question-beta', 0, config));
  });

  it('spreads across the configured range over the whole daily bank', () => {
    const speeds: number[] = [];
    for (const category of ['geography', 'history', 'languages'] as const) {
      for (const set of dailyQuestionBank(category, Date.UTC(2026, 9, 11))) {
        for (const question of set.questions) {
          for (const stage of [0, 1, 2, 3] as PressureStage[]) {
            speeds.push(hammerMarkerSpeed(question.id, stage, config));
          }
        }
      }
    }
    expect(speeds.length).toBeGreaterThan(1000);
    expect(Math.min(...speeds)).toBeGreaterThanOrEqual(config.markerSpeedMin);
    expect(Math.max(...speeds)).toBeLessThanOrEqual(config.markerSpeedMax);
    const span = config.markerSpeedMax - config.markerSpeedMin;
    expect(Math.min(...speeds)).toBeLessThan(config.markerSpeedMin + span * 0.1);
    expect(Math.max(...speeds)).toBeGreaterThan(config.markerSpeedMax - span * 0.1);
    const buckets = new Array(5).fill(0);
    for (const speed of speeds) {
      buckets[Math.min(4, Math.floor(((speed - config.markerSpeedMin) / span) * 5))] += 1;
    }
    for (const count of buckets) expect(count / speeds.length).toBeGreaterThan(0.12);
  });
});

describe('scoring a hammer tap from its moment', () => {
  const questionId = 'geography:2026-10-13:0:q4';

  it('derives the marker position from the time, not from the client', () => {
    expect(markerPositionAtElapsed(0, 1)).toBe(0);
    expect(markerPositionAtElapsed(1000, 1)).toBe(1);
    expect(markerPositionAtElapsed(1500, 1)).toBeCloseTo(0.5);
    expect(markerPositionAtElapsed(2000, 1)).toBe(0);
    // Отрицательное время не отводит маркер назад за ноль.
    expect(markerPositionAtElapsed(-500, 1)).toBe(0);
  });

  it('pays the full reward only for the moment the marker is on the target', () => {
    const attempt = hammerAttemptRules(questionId, [], config);
    const onTarget = (attempt.targetCenter / attempt.markerSpeed) * 1000;
    const scored = scoreHammerTap(questionId, [], config, onTarget);
    expect(scored.distance).toBeCloseTo(0, 10);
    expect(scored.result).toBe('perfect');
    expect(scored.progressAwarded).toBe(25);
    expect(scored.markerPosition).toBeCloseTo(attempt.targetCenter, 10);
  });

  it('turns a moment half a track away into a miss worth nothing', () => {
    const attempt = hammerAttemptRules(questionId, [], config);
    const away = attempt.targetCenter > 0.5 ? attempt.targetCenter - 0.5 : attempt.targetCenter + 0.5;
    const scored = scoreHammerTap(questionId, [], config, (away / attempt.markerSpeed) * 1000);
    expect(scored.distance).toBeCloseTo(1, 10);
    expect(scored.result).toBe('miss');
    expect(scored.progressAwarded).toBe(0);
  });

  it('scores the very same moment differently once pressure moves the target', () => {
    // Один и тот же момент удара не даёт одну и ту же награду: цель и скорость зависят от стадии,
    // поэтому заученное «хорошее время» на следующем круге уже не работает.
    const moment = 500;
    const scores = ([[], ['perfect'], ['perfect', 'perfect']] as const)
      .map((previous) => scoreHammerTap(questionId, previous, config, moment).distance);
    expect(new Set(scores).size).toBeGreaterThan(1);
  });

  it('agrees with the plain distance scoring it is built on', () => {
    for (let elapsed = 0; elapsed <= 3000; elapsed += 37) {
      const scored = scoreHammerTap(questionId, [], config, elapsed);
      const position = markerPositionAtElapsed(elapsed, scored.attempt.markerSpeed);
      const distance = normalizedHammerDistance(position, scored.attempt.targetCenter);
      expect(scored.distance).toBe(distance);
      expect(scored.result).toBe(scoreHammerDistance(distance, scored.attempt.stage, config).result);
    }
  });

  it('refuses a moment that is not a finite non-negative number', () => {
    expect(() => scoreHammerTap(questionId, [], config, Number.NaN)).toThrow(RangeError);
    expect(() => scoreHammerTap(questionId, [], config, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => scoreHammerTap(questionId, [], config, -1)).toThrow(RangeError);
  });
});

describe('mini-game config versions', () => {
  it('scores a legacy run with the legacy zones and a new run with the narrow ones', () => {
    expect(scoreHammerDistance(0.2, 0, LEGACY_HAMMER_MINI_GAME_CONFIG).result).toBe('great');
    expect(scoreHammerDistance(0.2, 0, config).result).toBe('good');
  });

  it('accepts only known configs, from an object or stored JSON', () => {
    expect(supportedMiniGameConfig(JSON.stringify(config))).toBe(config);
    expect(supportedMiniGameConfig(JSON.parse(JSON.stringify(LEGACY_HAMMER_MINI_GAME_CONFIG)))).toBe(LEGACY_HAMMER_MINI_GAME_CONFIG);
    expect(supportedMiniGameConfig({ ...config, markerSpeedMax: 3 })).toBeNull();
    expect(supportedMiniGameConfig('not json')).toBeNull();
  });
});
