import { describe, expect, it } from 'vitest';
import {
  CURRENT_HAMMER_MINI_GAME,
  hammerAttemptRules,
  normalizedHammerDistance,
  scoreHammerDistance,
} from '@clutch/shared';
import {
  cappedFrameDeltaMs,
  hammerTierZones,
  markerPositionAtElapsed,
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
      return markerPositionAtElapsed(elapsed, 1.3);
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

  // Регресс: маркер когда-то замирал на цели при prefers-reduced-motion, и каждый удар
  // выходил идеальным. Положение маркера обязано зависеть только от времени и скорости,
  // и никогда — от того, где стоит цель.
  it('sweeps the whole track and never parks on the target', () => {
    const attempt = hammerAttemptRules(
      'reduced-motion-question',
      ['great', 'weak'],
      CURRENT_HAMMER_MINI_GAME.config,
    );
    const positions = Array.from({ length: 400 }, (_, step) =>
      markerPositionAtElapsed(step * 10, attempt.markerSpeed));

    expect(Math.min(...positions)).toBeLessThan(0.02);
    expect(Math.max(...positions)).toBeGreaterThan(0.98);

    // Идеальных попаданий среди произвольных моментов — меньшинство, а не все подряд.
    const perfect = positions.filter((position) =>
      scoreHammerDistance(
        normalizedHammerDistance(position, attempt.targetCenter),
        attempt.stage,
        CURRENT_HAMMER_MINI_GAME.config,
      ).result === 'perfect').length;
    expect(perfect / positions.length).toBeLessThan(0.15);
  });

  it('draws nested bands equal to the scoring thresholds', () => {
    const attempt = hammerAttemptRules(
      'geometry-question',
      ['great', 'weak'],
      CURRENT_HAMMER_MINI_GAME.config,
    );
    const zones = hammerTierZones(attempt);
    expect(zones.map(({ result }) => result)).toEqual([
      'weak',
      'good',
      'great',
      'perfect',
    ]);
    [68, 52, 22.4, 4.8].forEach((width, index) => {
      expect(zones[index].widthPercent).toBeCloseTo(width);
    });
    for (const zone of zones) {
      expect(zone.leftPercent).toBeCloseTo(
        (attempt.targetCenter - attempt.thresholds[zone.result] / 2) * 100,
      );
      expect(zone.widthPercent).toBeCloseTo(attempt.thresholds[zone.result] * 100);
    }
  });

  it('draws the perfect zone exactly where a strike scores perfect', () => {
    const config = CURRENT_HAMMER_MINI_GAME.config;
    for (const previous of [[], ['great'], ['great', 'weak'], ['good', 'good', 'good']] as const) {
      const attempt = hammerAttemptRules('draw-score-question', previous, config);
      const perfect = hammerTierZones(attempt).find((zone) => zone.result === 'perfect')!;
      const left = perfect.leftPercent / 100;
      const right = (perfect.leftPercent + perfect.widthPercent) / 100;
      const score = (position: number) => scoreHammerDistance(
        normalizedHammerDistance(position, attempt.targetCenter), attempt.stage, config,
      ).result;
      expect(score(left + 1e-6)).toBe('perfect');
      expect(score(right - 1e-6)).toBe('perfect');
      expect(score(left - 1e-3)).toBe('great');
      expect(score(right + 1e-3)).toBe('great');
    }
  });
});
