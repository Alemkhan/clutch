import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasSeenHammerIntro, markHammerIntroSeen } from './hammerIntro';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('hammer intro flag', () => {
  beforeEach(() => vi.stubGlobal('localStorage', new MemoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('is not seen on first visit', () => {
    expect(hasSeenHammerIntro()).toBe(false);
  });

  it('is seen after being marked', () => {
    markHammerIntroSeen();
    expect(hasSeenHammerIntro()).toBe(true);
  });

  it('shows the intro and does not throw when storage fails', () => {
    const broken = {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
    };
    vi.stubGlobal('localStorage', broken);
    expect(hasSeenHammerIntro()).toBe(false);
    expect(() => markHammerIntroSeen()).not.toThrow();
  });

  it('shows the intro when localStorage is missing entirely', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(hasSeenHammerIntro()).toBe(false);
    expect(() => markHammerIntroSeen()).not.toThrow();
  });
});
