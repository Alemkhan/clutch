import { describe, expect, it } from 'vitest';
import {
  cappedFrameDeltaMs,
  HAMMER_TIER_ZONES,
  markerPositionAtElapsed,
  REDUCED_MOTION_MARKER_POSITION,
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

  it('centres the marker under reduced motion', () => {
    expect(REDUCED_MOTION_MARKER_POSITION).toBe(0.5);
  });

  it('draws nested bands equal to the scoring thresholds', () => {
    expect(HAMMER_TIER_ZONES.map(({ result }) => result)).toEqual([
      'weak',
      'good',
      'great',
      'perfect',
    ]);
    expect(HAMMER_TIER_ZONES.map(({ widthPercent }) => widthPercent)).toEqual([
      85,
      65,
      35,
      15,
    ]);
    expect(HAMMER_TIER_ZONES.map(({ leftPercent }) => leftPercent)).toEqual(
      expect.arrayContaining([
        expect.closeTo(7.5),
        expect.closeTo(17.5),
        expect.closeTo(32.5),
        expect.closeTo(42.5),
      ]),
    );
  });
});
