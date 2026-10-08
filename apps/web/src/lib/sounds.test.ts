import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSoundPreferenceMemory } from './soundPreference';
import { playSound, setSoundEnabled, strikeSoundFor, toggleSound, type SoundName } from './sounds';

const names: SoundName[] = [
  'click', 'tick', 'timeout', 'correct', 'incorrect', 'hammerTap',
  ...Object.values(strikeSoundFor), 'matchWin', 'matchLose',
];

describe('playSound with the sound preference', () => {
  let created: number;
  let played: number;

  beforeEach(() => {
    resetSoundPreferenceMemory();
    created = 0;
    played = 0;
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    vi.stubGlobal('Audio', class {
      preload = '';
      volume = 1;
      constructor() { created += 1; }
      cloneNode() { return this; }
      play() { played += 1; return Promise.resolve(); }
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('plays when enabled', () => {
    playSound('click');
    expect(created).toBe(1);
    expect(played).toBe(1);
  });

  it('creates no Audio and never calls play for any sound when muted', () => {
    setSoundEnabled(false);
    names.forEach((name) => playSound(name));
    expect(created).toBe(0);
    expect(played).toBe(0);
  });

  it('toggling itself makes no sound and resumes playback when re-enabled', () => {
    setSoundEnabled(false);
    expect(toggleSound()).toBe(true);
    expect(played).toBe(0);
    playSound('click');
    expect(played).toBe(1);
  });
});
