import { describe, expect, it } from 'vitest';
import {
  CURRENT_HAMMER_MINI_GAME,
  SKILL_REWARDS,
  hammerAttemptRules,
  type SkillResult,
} from '@clutch/shared';
import { MIN_ZONE_LABEL_GAP, hammerZoneLabels, remainingText, seriesNote, strikeGain } from './hammerStrike';

const config = CURRENT_HAMMER_MINI_GAME.config;
const hit: SkillResult[] = ['great', 'good', 'perfect'];

describe('hammerZoneLabels', () => {
  it.each([0, 1, 2, 3])('stage %i: labels match shared rewards and thresholds', (stage) => {
    const previous = hit.slice(0, stage);
    const attempt = hammerAttemptRules('q-zones', previous, config);
    expect(attempt.stage).toBe(stage);
    const labels = hammerZoneLabels(attempt);

    // Центр — один, очки perfect; остальные tier — по две подписи (слева и справа) или ни одной, если кольцо узкое.
    expect(labels.filter((l) => l.result === 'perfect')).toHaveLength(1);
    for (const tier of ['great', 'good', 'weak'] as const) {
      const sides = labels.filter((l) => l.result === tier);
      expect([0, 2]).toContain(sides.length);
      for (const side of sides) expect(side.points).toBe(SKILL_REWARDS[tier]);
    }
    expect(labels.find((l) => l.result === 'perfect')?.points).toBe(SKILL_REWARDS.perfect);

    // Подпись лежит внутри кольца своего tier: между внутренним порогом и своим.
    const { thresholds, targetCenter } = attempt;
    const inner = { great: thresholds.perfect, good: thresholds.great, weak: thresholds.good };
    for (const label of labels.filter((l) => l.result !== 'perfect')) {
      const half = Math.abs(label.leftPercent / 100 - targetCenter);
      const tier = label.result as 'great' | 'good' | 'weak';
      expect(half).toBeGreaterThan(inner[tier] / 2);
      expect(half).toBeLessThan(thresholds[tier] / 2);
    }
  });

  it.each([0, 1, 2, 3])('stage %i: no two labels are closer than the minimum gap', (stage) => {
    const attempt = hammerAttemptRules('q-zones', hit.slice(0, stage), config);
    const centers = hammerZoneLabels(attempt).map((l) => l.leftPercent / 100).sort((a, b) => a - b);
    for (let i = 1; i < centers.length; i++) {
      expect(centers[i] - centers[i - 1]).toBeGreaterThanOrEqual(MIN_ZONE_LABEL_GAP - 1e-9);
    }
  });

  it('keeps the centre label and drops the narrow rings at the highest pressure', () => {
    const wide = hammerZoneLabels(hammerAttemptRules('q-zones', [], config));
    const tight = hammerZoneLabels(hammerAttemptRules('q-zones', hit, config));
    expect(wide.length).toBeGreaterThan(tight.length);
    expect(tight.filter((l) => l.result === 'perfect')).toHaveLength(1);
    expect(tight.some((l) => l.result === 'great')).toBe(false);
    expect(wide.some((l) => l.result === 'great')).toBe(true);
  });

  it('rings narrow as the pressure stage rises', () => {
    const spread = (stage: number) => {
      const a = hammerAttemptRules('q-zones', hit.slice(0, stage), config);
      const weak = hammerZoneLabels(a).filter((l) => l.result === 'weak');
      return Math.abs(weak[1].leftPercent - weak[0].leftPercent);
    };
    expect(spread(3)).toBeLessThan(spread(0));
  });
});

describe('strike gain text', () => {
  it('shows the new percent, gain and what is left', () => {
    expect(strikeGain(36, 18)).toEqual({ total: 54, gain: 18, remaining: 46 });
    expect(remainingText(46)).toBe('До 100% — ещё 46%');
  });

  it('clamps at the target and says it honestly instead of "ещё 0%"', () => {
    const end = strikeGain(90, 25);
    expect(end).toEqual({ total: 100, gain: 10, remaining: 0 });
    expect(remainingText(end.remaining)).toBe('Цель 100% достигнута');
  });

  it('a miss adds nothing', () => {
    expect(strikeGain(40, 0)).toEqual({ total: 40, gain: 0, remaining: 60 });
  });
});

describe('seriesNote', () => {
  it('appears only when the hit raised the pressure stage', () => {
    expect(seriesNote([], 'great')).toBe('Серия 1 · зоны стали уже');
    expect(seriesNote(['great'], 'weak')).toBe('Серия 2 · зоны стали уже');
  });

  it('is absent on a miss and at the top stage', () => {
    expect(seriesNote(['great'], 'miss')).toBeNull();
    expect(seriesNote(['great', 'good', 'perfect'], 'great')).toBeNull();
  });
});
