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

  it('invites to be first when nobody played', () => {
    expect(buildLastStandHook({ dateKey: 'd', entries: [] })).toEqual({
      kind: 'empty',
      headline: 'Сегодня ещё никто не играл',
      detail: 'Будь первым и задай планку дня',
    });
  });

  it('reports players and best result', () => {
    expect(buildLastStandHook({ dateKey: 'd', entries: [entry(1)] })).toMatchObject({
      kind: 'played', headline: 'Сегодня играл 1 человек', detail: 'Лучший результат: 1 круг',
    });
    expect(buildLastStandHook({ dateKey: 'd', entries: [entry(3), entry(9), entry(2)] })).toMatchObject({
      headline: 'Сегодня играли 3 человека', detail: 'Лучший результат: 9 кругов',
    });
    expect(buildLastStandHook({ dateKey: 'd', entries: [entry(2), entry(0)] })!.detail).toBe('Лучший результат: 2 круга');
  });

  it('does not claim an exact count at the server row limit', () => {
    const entries = Array.from({ length: 50 }, () => entry(4));
    expect(buildLastStandHook({ dateKey: 'd', entries })!.headline).toBe('Сегодня играли 50+ человек');
  });
});
