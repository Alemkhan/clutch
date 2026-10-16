import { describe, expect, it } from 'vitest';
import { CURRENT_HAMMER_MINI_GAME } from '@clutch/shared';
import { validateMiniGameConfig } from './clientMatchRules';

describe('mini-game config validation', () => {
  it('accepts the current config', () => {
    expect(validateMiniGameConfig(CURRENT_HAMMER_MINI_GAME.config)).toEqual(
      CURRENT_HAMMER_MINI_GAME.config,
    );
  });

  it('rejects unsupported configs', () => {
    expect(() => validateMiniGameConfig({
      markerSpeed: 0.8,
      targetWidth: 0.2,
      perfectWidth: 0.15,
      pressure: CURRENT_HAMMER_MINI_GAME.config.pressure,
    })).toThrow(/not supported/i);
    expect(() => validateMiniGameConfig({
      markerSpeed: 0.8,
      targetWidth: 0.85,
      perfectWidth: 0.06,
      pressure: CURRENT_HAMMER_MINI_GAME.config.pressure,
    })).toThrow(/not supported/i);
    expect(() => validateMiniGameConfig({
      ...CURRENT_HAMMER_MINI_GAME.config,
      pressure: {
        ...CURRENT_HAMMER_MINI_GAME.config.pressure,
        stageMultipliers: [1, 0.9, 0.8, 0.6],
      },
    })).toThrow(/not supported/i);
  });
});
