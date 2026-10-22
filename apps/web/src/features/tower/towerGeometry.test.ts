import { describe, expect, it } from 'vitest';
import {
  CURRENT_HAMMER_MINI_GAME,
  SKILL_REWARDS,
  hammerAttemptRules,
  hammerThresholdsForStage,
  normalizedHammerDistance,
  scoreHammerDistance,
} from '@clutch/shared';
import {
  BLOCK_WIDTH_PERCENT,
  TRACK_FRACTION,
  blockLeftPercent,
  towerFloorCount,
  towerLanding,
  towerThresholdLabels,
} from './towerGeometry';

const config = CURRENT_HAMMER_MINI_GAME.config;

describe('tower geometry', () => {
  it('keeps the block inside the scene at both ends of the track', () => {
    expect(blockLeftPercent(0)).toBeCloseTo(0, 6);
    expect(blockLeftPercent(1) + BLOCK_WIDTH_PERCENT).toBeCloseTo(100, 6);
    expect(TRACK_FRACTION).toBeCloseTo(1 / 1.5, 9);
  });

  it('shows the overlap as exactly 1 - d, the distance the server scores', () => {
    for (const [x, c] of [[0.5, 0.5], [0.4, 0.5], [0.62, 0.5], [0.2, 0.55], [0.9, 0.45]]) {
      const landing = towerLanding(x, c, 'good');
      const d = normalizedHammerDistance(x, c);
      expect(landing.overlapPercent).toBe(Math.round((1 - d) * 100));
      const landedWidth = landing.landed?.width ?? 0;
      const expected = (1 - d) * BLOCK_WIDTH_PERCENT;
      expect(landedWidth).toBeCloseTo(Math.max(0, expected), 6);
    }
  });

  it('scores mirrored hits identically across the track, including edge positions', () => {
    // Stage 3 permits the widest target offset (centres .425..575); include both
    // allowed edges and the track endpoints to catch direction-dependent drift.
    const targetCenters = [0.425, 0.45, 0.5, 0.55, 0.575];
    const offsets = [0, 0.001, 0.01, 0.03, 0.075, 0.12, 0.2, 0.25, 0.35, 0.425];

    for (const center of targetCenters) {
      for (const offset of offsets) {
        if (offset > center || offset > 1 - center) continue;
        const leftPosition = center - offset;
        const rightPosition = center + offset;
        const leftDistance = normalizedHammerDistance(leftPosition, center);
        const rightDistance = normalizedHammerDistance(rightPosition, center);
        expect(leftDistance).toBeCloseTo(rightDistance, 12);
        expect(scoreHammerDistance(leftDistance, 3, config).result)
          .toBe(scoreHammerDistance(rightDistance, 3, config).result);

        const left = towerLanding(leftPosition, center, 'good');
        const right = towerLanding(rightPosition, center, 'good');
        expect(left.overlapPercent).toBe(right.overlapPercent);
        expect(left.landed?.width ?? 0).toBeCloseTo(right.landed?.width ?? 0, 9);
        expect(left.overhang?.width ?? 0).toBeCloseTo(right.overhang?.width ?? 0, 9);
        expect(left.side).toBe(offset === 0 ? right.side : -1);
        expect(right.side).toBe(1);
      }
    }

    // A block centred at either end still fits the scene and mirrors exactly.
    for (const center of [0.425, 0.575]) {
      const left = towerLanding(0, center, 'miss').overhang!;
      const right = towerLanding(1, center, 'miss').overhang!;
      expect(left.width).toBeCloseTo(BLOCK_WIDTH_PERCENT, 9);
      expect(right.width).toBeCloseTo(BLOCK_WIDTH_PERCENT, 9);
      expect(left.left).toBeCloseTo(100 - (right.left + right.width), 9);
    }
  });

  it('breaks off the overhang on the side of the miss, and drops the whole block on a miss', () => {
    const right = towerLanding(0.6, 0.5, 'great');
    expect(right.side).toBe(1);
    expect(right.overhang!.width).toBeCloseTo(0.1 * TRACK_FRACTION * 100, 6);
    const left = towerLanding(0.4, 0.5, 'great');
    expect(left.side).toBe(-1);
    const exact = towerLanding(0.5, 0.5, 'perfect');
    expect(exact.overhang).toBeNull();
    const miss = towerLanding(0.1, 0.8, 'miss');
    expect(miss.landed).toBeNull();
    expect(miss.overhang!.width).toBeCloseTo(BLOCK_WIDTH_PERCENT, 6);
  });

  it('labels the thresholds from the stage of the attempt, not from the mockup', () => {
    for (const previous of [[], ['perfect'], ['perfect', 'good', 'weak', 'great']] as const) {
      const attempt = hammerAttemptRules('q1', previous, config);
      const labels = towerThresholdLabels(attempt);
      const thresholds = hammerThresholdsForStage(attempt.stage, config);
      expect(labels.map((label) => label.result)).toEqual(['perfect', 'great', 'good', 'weak', 'miss']);
      for (const label of labels.slice(0, 4)) {
        const key = label.result as 'perfect' | 'great' | 'good' | 'weak';
        expect(label.minOverlap).toBe(Math.round((1 - thresholds[key]) * 100));
        expect(label.points).toBe(SKILL_REWARDS[key]);
        // Совпадение ровно на пороге даёт именно этот уровень.
        expect(scoreHammerDistance(thresholds[key], attempt.stage, config).result).toBe(key);
      }
    }
  });

  it('grows the tower only with non-miss results', () => {
    expect(towerFloorCount([])).toBe(1);
    expect(towerFloorCount(['perfect', 'miss', 'weak'])).toBe(3);
  });
});
