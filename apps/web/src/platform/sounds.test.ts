import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSoundPreferenceMemory } from './soundPreference';
import {
  getSoundDiagnostic, installSoundUnlock, playSound, resetSoundsForTests,
  selectSupportedSources, setSoundEnabled, strikeSoundFor, toggleSound,
  type SoundName,
} from './sounds';

const names: SoundName[] = [
  'tick', 'timeout', 'correct', 'incorrect', 'hammerTap',
  ...Object.values(strikeSoundFor), 'matchWin', 'matchLose',
];

describe('sound playback', () => {
  let created: number;
  let played: number;
  let playResults: Array<'resolve' | 'reject'>;

  beforeEach(() => {
    resetSoundPreferenceMemory();
    resetSoundsForTests();
    created = 0;
    played = 0;
    playResults = [];
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    vi.stubGlobal('Audio', class {
      preload = '';
      volume = 1;
      muted = false;
      currentTime = 1;
      constructor(public src = '') { created += 1; }
      canPlayType(type: string) { return type.startsWith('audio/ogg') ? 'probably' : ''; }
      cloneNode() { return new Audio(this.src); }
      pause() {}
      play() {
        played += 1;
        return playResults.shift() === 'reject'
          ? Promise.reject(new Error('private browser detail'))
          : Promise.resolve();
      }
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('plays a supported source and records success', async () => {
    await expect(playSound('correct')).resolves.toBe(true);
    expect(created).toBe(3); // capability probe, cached base, playable clone
    expect(played).toBe(1);
    expect(getSoundDiagnostic()).toEqual({ state: 'ready' });
  });

  it('falls back to AAC where Ogg Vorbis is unsupported, as on iOS', async () => {
    const playedSrc: string[] = [];
    vi.stubGlobal('Audio', class {
      preload = '';
      volume = 1;
      muted = false;
      currentTime = 1;
      constructor(public src = '') {}
      canPlayType(type: string) { return type.startsWith('audio/mp4') ? 'probably' : ''; }
      cloneNode() { return new Audio(this.src); }
      pause() {}
      play() { playedSrc.push(this.src); return Promise.resolve(); }
    });
    await expect(playSound('correct')).resolves.toBe(true);
    expect(playedSrc).toEqual(['/sfx/correct.m4a']);
  });

  it('keeps a safe diagnostic when play rejects', async () => {
    playResults.push('reject');
    await expect(playSound('correct')).resolves.toBe(false);
    expect(getSoundDiagnostic()).toEqual({
      state: 'failed', reason: 'play-rejected', phase: 'play', sound: 'correct',
    });
    expect(console.warn).toHaveBeenCalledWith('[audio] playback unavailable', {
      reason: 'play-rejected', phase: 'play', sound: 'correct',
    });
  });

  it('selects the next supported format from an ordered fallback list', () => {
    const sources = [
      { src: '/sound.ogg', type: 'audio/ogg' },
      { src: '/sound.mp3', type: 'audio/mpeg' },
    ];
    expect(selectSupportedSources(sources, (type) => type === 'audio/mpeg' ? 'probably' : ''))
      .toEqual([sources[1]]);
  });

  it('reports the current OGG asset as unsupported without attempting play', async () => {
    vi.stubGlobal('Audio', class { canPlayType() { return ''; } });
    await expect(playSound('correct')).resolves.toBe(false);
    expect(played).toBe(0);
    expect(getSoundDiagnostic()).toEqual({
      state: 'failed', reason: 'unsupported-format', phase: 'play', sound: 'correct',
    });
  });

  it('unlocks muted audio on the first successful pointer gesture', async () => {
    const target = new EventTarget() as Document;
    const remove = installSoundUnlock(target);
    target.dispatchEvent(new Event('click'));
    await Promise.resolve();
    await Promise.resolve();
    expect(played).toBe(1);
    expect(getSoundDiagnostic()).toEqual({ state: 'ready' });
    target.dispatchEvent(new Event('click'));
    expect(played).toBe(1);
    remove();
  });

  it('keeps the unlock listener after rejection so a later gesture can retry', async () => {
    playResults.push('reject', 'resolve');
    const target = new EventTarget() as Document;
    installSoundUnlock(target);
    target.dispatchEvent(new Event('click'));
    await Promise.resolve();
    await Promise.resolve();
    expect(getSoundDiagnostic()).toMatchObject({ state: 'failed', reason: 'unlock-rejected' });
    target.dispatchEvent(new Event('click'));
    await Promise.resolve();
    await Promise.resolve();
    expect(played).toBe(2);
    expect(getSoundDiagnostic()).toEqual({ state: 'ready' });
  });

  it('creates no Audio and never calls play for any sound when muted', async () => {
    setSoundEnabled(false);
    await Promise.all(names.map((name) => playSound(name)));
    expect(created).toBe(0);
    expect(played).toBe(0);
  });

  it('unlocks without an audible toggle sound when re-enabled', async () => {
    setSoundEnabled(false);
    expect(toggleSound()).toBe(true);
    await Promise.resolve();
    expect(played).toBe(1);
  });
});

describe('sound playback through Web Audio (iOS)', () => {
  let started: string[];
  let htmlPlays: number;

  beforeEach(() => {
    resetSoundPreferenceMemory();
    resetSoundsForTests();
    started = [];
    htmlPlays = 0;
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    vi.stubGlobal('Audio', class {
      preload = '';
      volume = 1;
      muted = false;
      constructor(public src = '') {}
      canPlayType(type: string) { return type.startsWith('audio/mp4') ? 'maybe' : ''; }
      cloneNode() { return new Audio(this.src); }
      pause() {}
      play() { htmlPlays += 1; return Promise.reject(new Error('NotAllowedError')); }
    });
    vi.stubGlobal('fetch', async (src: string) => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode(src).buffer }));
    vi.stubGlobal('AudioContext', class {
      state: AudioContextState = 'suspended';
      destination = {};
      async resume() { this.state = 'running'; }
      createBuffer() { return {}; }
      createGain() { return { gain: { value: 1 }, connect() {} }; }
      createBufferSource() {
        const node = { buffer: null as unknown, connect() {}, start: () => { started.push(String((node.buffer as { src?: string } | null)?.src ?? 'silent')); } };
        return node;
      }
      decodeAudioData(data: ArrayBuffer, ok: (buffer: unknown) => void) { ok({ src: new TextDecoder().decode(data) }); }
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('after one tap plays the win sound without a gesture and without an <audio> element', async () => {
    const target = new EventTarget() as Document;
    installSoundUnlock(target);
    target.dispatchEvent(new Event('touchend'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(playSound('matchWin')).resolves.toBe(true);
    expect(started).toContain('/sfx/match-win.m4a');
    expect(htmlPlays).toBe(0);
    expect(getSoundDiagnostic()).toEqual({ state: 'ready' });
  });

  it('before any tap falls back to <audio> and reports the rejection', async () => {
    await expect(playSound('matchWin')).resolves.toBe(false);
    expect(htmlPlays).toBe(1);
    expect(getSoundDiagnostic()).toMatchObject({ state: 'failed', reason: 'play-rejected' });
  });
});
