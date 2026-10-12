import { describe, expect, it } from 'vitest';
import { buildLastStandHook } from './lastStandHook';

const entry = (survived: number) => ({ displayName: 'A', survived, completedAt: 1 });

describe('buildLastStandHook', () => {
  it('returns null without usable data', () => {
    expect(buildLastStandHook(null)).toBeNull();
    expect(buildLastStandHook(undefined)).toBeNull();
    expect(buildLastStandHook({ nope: 1 })).toBeNull();
    expect(buildLastStandHook({ dateKey: 'd', entries: [{ displayName: 1 }] })).toBeNull();
  });

  it('shows nothing when nobody has a result yet (no "nobody played" copy)', () => {
    expect(buildLastStandHook({ dateKey: 'd', entries: [] })).toBeNull();
    expect(buildLastStandHook({ dateKey: 'd', entries: [entry(0)] })).toBeNull();
  });

  it('reports only the best result of the day, never a player count', () => {
    expect(buildLastStandHook({ dateKey: 'd', entries: [entry(1)] })).toEqual({
      kind: 'best', headline: 'Лучший результат дня: 1 круг',
    });
    expect(buildLastStandHook({ dateKey: 'd', entries: [entry(3), entry(9), entry(2)] })!.headline)
      .toBe('Лучший результат дня: 9 кругов');
    expect(buildLastStandHook({ dateKey: 'd', entries: [entry(2), entry(0)] })!.headline)
      .toBe('Лучший результат дня: 2 круга');
  });
});
