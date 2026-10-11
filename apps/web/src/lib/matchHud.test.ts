import { describe, expect, it } from 'vitest';
import type { Phase } from './gameSession';
import { shouldShowMatchHud } from './matchHud';

describe('shouldShowMatchHud', () => {
  const expected: Record<Phase, boolean> = {
    home: false,
    categories: false,
    matchmaking: false,
    question: true,
    resolution: true,
    hammer: true,
    result: false,
    profile: false,
    training: false,
    lastStand: false,
    // У соло-забега свой HUD с одной полосой и темпом.
    solo: false,
  };

  for (const [phase, visible] of Object.entries(expected) as [Phase, boolean][]) {
    it(`${visible ? 'shows' : 'hides'} the HUD in ${phase}`, () => {
      expect(shouldShowMatchHud(phase)).toBe(visible);
    });
  }
});
