import { describe, expect, it } from 'vitest';
import { CURRENT_ASYNC_MATCH_CONDITIONS, hammerAttemptRules } from '@clutch/shared';
import {
  cappedFrameDeltaMs,
  hammerTierZones,
  markerPositionAtElapsed,
  reducedMotionMarkerPosition,
} from './hammerMotion';

describe('hammer motion', () => {
  it('has identical position after equal active time at 30, 60, and 120 Hz', () => {
    const positions = [30, 60, 120].map((hz) => {
      let elapsed = 0;
      let previous: number | null = null;
      for (let frame = 0; frame <= hz * 3; frame += 1) {
        const now = frame * (1000 / hz);
        elapsed += cappedFrameDeltaMs(previous, now);
        previous = now;
      }
      return markerPositionAtElapsed(elapsed, 0.8);
    });
    expect(positions[0]).toBeCloseTo(positions[1], 10);
    expect(positions[1]).toBeCloseTo(positions[2], 10);
  });

  it('reflects at both track edges', () => {
    expect(markerPositionAtElapsed(0, 1)).toBe(0);
    expect(markerPositionAtElapsed(1000, 1)).toBe(1);
    expect(markerPositionAtElapsed(1250, 1)).toBeCloseTo(0.75);
    expect(markerPositionAtElapsed(2000, 1)).toBe(0);
  });

  it('caps a long frame and resumes with a fresh timestamp', () => {
    expect(cappedFrameDeltaMs(100, 600)).toBe(50);
    expect(cappedFrameDeltaMs(null, 600)).toBe(0);
  });

  it('places the reduced-motion marker on the shifted target', () => {
    const attempt = hammerAttemptRules(
      'reduced-motion-question',
      ['great', 'weak'],
      CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.config,
    );
    expect(reducedMotionMarkerPosition(attempt)).toBe(attempt.targetCenter);
  });

  it('draws nested bands equal to the scoring thresholds', () => {
    const attempt = hammerAttemptRules(
      'geometry-question',
      ['great', 'weak'],
      CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.config,
    );
    const zones = hammerTierZones(attempt);
    expect(zones.map(({ result }) => result)).toEqual([
      'weak',
      'good',
      'great',
      'perfect',
    ]);
    [68, 52, 28, 12].forEach((width, index) => {
      expect(zones[index].widthPercent).toBeCloseTo(width);
    });
    for (const zone of zones) {
      expect(zone.leftPercent).toBeCloseTo(
        (attempt.targetCenter - attempt.thresholds[zone.result] / 2) * 100,
      );
      expect(zone.widthPercent).toBeCloseTo(attempt.thresholds[zone.result] * 100);
    }
  });
});
