import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSoundEnabled, resetSoundPreferenceMemory, writeSoundEnabled } from './soundPreference';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('sound preference', () => {
  beforeEach(() => { resetSoundPreferenceMemory(); vi.stubGlobal('localStorage', new MemoryStorage()); });
  afterEach(() => vi.unstubAllGlobals());

  it('is enabled by default', () => {
    expect(readSoundEnabled()).toBe(true);
  });

  it('toggles off and on', () => {
    writeSoundEnabled(false);
    expect(readSoundEnabled()).toBe(false);
    writeSoundEnabled(true);
    expect(readSoundEnabled()).toBe(true);
  });

  it('persists across a reload', () => {
    writeSoundEnabled(false);
    resetSoundPreferenceMemory(); // simulates a fresh page load
    expect(readSoundEnabled()).toBe(false);
  });

  it('stays enabled and does not throw when storage fails, but toggles in memory', () => {
    vi.stubGlobal('localStorage', {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
    });
    expect(readSoundEnabled()).toBe(true);
    expect(() => writeSoundEnabled(false)).not.toThrow();
    expect(readSoundEnabled()).toBe(false);
  });

  it('stays enabled when localStorage is missing', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(readSoundEnabled()).toBe(true);
    expect(() => writeSoundEnabled(false)).not.toThrow();
  });
});
