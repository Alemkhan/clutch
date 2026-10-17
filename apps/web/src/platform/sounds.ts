import type { SkillResult } from '@clutch/shared';
import { logAnalyticsEvent } from './api';
import { readSoundEnabled, writeSoundEnabled } from './soundPreference';

export interface SoundSource {
  src: string;
  type: string;
}

// Safari and Telegram on iOS cannot decode Ogg Vorbis, so every sound also ships as AAC
// (converted from the same OGG files with ffmpeg).
const encodings = (name: string): readonly SoundSource[] => [
  { src: `/sfx/${name}.ogg`, type: 'audio/ogg; codecs="vorbis"' },
  { src: `/sfx/${name}.m4a`, type: 'audio/mp4; codecs="mp4a.40.2"' },
];

const soundSources = {
  tick: encodings('tick'), timeout: encodings('timeout'), correct: encodings('correct'),
  incorrect: encodings('incorrect'), hammerTap: encodings('hammer-tap'),
  strikePerfect: encodings('strike-perfect'), strikeGreat: encodings('strike-great'),
  strikeGood: encodings('strike-good'), strikeWeak: encodings('strike-weak'),
  strikeMiss: encodings('strike-miss'), matchWin: encodings('match-win'),
  matchLose: encodings('match-lose'),
} as const;

export type SoundName = keyof typeof soundSources;
export type SoundFailureReason = 'unsupported-format' | 'play-rejected' | 'unlock-rejected';
export type SoundDiagnostic =
  | { state: 'idle' | 'ready' }
  | { state: 'failed'; reason: SoundFailureReason; phase: 'play' | 'unlock'; sound: SoundName };

let diagnostic: SoundDiagnostic = { state: 'idle' };
const reportedFailures = new Set<string>();
const cache = new Map<string, HTMLAudioElement>();

export function getSoundDiagnostic(): SoundDiagnostic {
  return diagnostic;
}

function reportFailure(reason: SoundFailureReason, phase: 'play' | 'unlock', sound: SoundName): void {
  diagnostic = { state: 'failed', reason, phase, sound };
  const key = `${reason}:${phase}:${sound}`;
  if (reportedFailures.has(key)) return;
  reportedFailures.add(key);
  // Do not include the rejected value: stable fields are enough for diagnosis
  // and browser errors may contain environment details.
  console.warn('[audio] playback unavailable', { reason, phase, sound });
  // Продуктовое событие о тихом фолбэке (R22): те же стабильные поля, без деталей браузера.
  logAnalyticsEvent('sound_failure', { reason, phase, sound });
}

function markReady(): void {
  diagnostic = { state: 'ready' };
}

export function selectSupportedSources(
  sources: readonly SoundSource[],
  canPlayType: (type: string) => CanPlayTypeResult,
): SoundSource[] {
  return sources.filter(({ type }) => canPlayType(type) !== '');
}

function playableSources(name: SoundName): SoundSource[] {
  const probe = new Audio();
  if (typeof probe.canPlayType !== 'function') return [...soundSources[name]];
  return selectSupportedSources(soundSources[name], (type) => probe.canPlayType(type));
}

function getAudio(source: SoundSource): HTMLAudioElement {
  let audio = cache.get(source.src);
  if (!audio) {
    audio = new Audio(source.src);
    audio.preload = 'auto';
    cache.set(source.src, audio);
  }
  return audio;
}

async function trySources(name: SoundName, volume: number, phase: 'play' | 'unlock'): Promise<boolean> {
  const sources = playableSources(name);
  if (sources.length === 0) {
    reportFailure('unsupported-format', phase, name);
    return false;
  }
  for (const source of sources) {
    const instance = getAudio(source).cloneNode(true) as HTMLAudioElement;
    instance.volume = volume;
    if (phase === 'unlock') instance.muted = true;
    try {
      await instance.play();
      if (phase === 'unlock') {
        instance.pause();
        instance.currentTime = 0;
      }
      markReady();
      return true;
    } catch {
      // Try the next supported encoding before exposing a failure state.
    }
  }
  reportFailure(phase === 'unlock' ? 'unlock-rejected' : 'play-rejected', phase, name);
  return false;
}

const listeners = new Set<() => void>();

export function isSoundEnabled(): boolean {
  return readSoundEnabled();
}

export function setSoundEnabled(enabled: boolean): void {
  writeSoundEnabled(enabled);
  listeners.forEach((listener) => listener());
}

export function toggleSound(): boolean {
  const next = !isSoundEnabled();
  setSoundEnabled(next);
  if (next) void unlockSound();
  return next;
}

export function subscribeSound(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function playSound(name: SoundName, volume = 1): Promise<boolean> {
  // Muted: return before any Audio is created, cloned or played.
  if (!isSoundEnabled()) return Promise.resolve(false);
  return trySources(name, volume, 'play');
}

export function unlockSound(): Promise<boolean> {
  if (!isSoundEnabled()) return Promise.resolve(false);
  return trySources('correct', 0, 'unlock');
}

export function installSoundUnlock(target: Document = document): () => void {
  let removed = false;
  const handleGesture = () => {
    if (!isSoundEnabled()) return;
    void unlockSound().then((unlocked) => { if (unlocked) remove(); });
  };
  const remove = () => {
    if (removed) return;
    removed = true;
    target.removeEventListener('pointerdown', handleGesture);
    target.removeEventListener('keydown', handleGesture);
  };
  target.addEventListener('pointerdown', handleGesture);
  target.addEventListener('keydown', handleGesture);
  return remove;
}

// Keeps module-level cache and diagnostics isolated between unit cases.
export function resetSoundsForTests(): void {
  cache.clear();
  reportedFailures.clear();
  diagnostic = { state: 'idle' };
}

export const strikeSoundFor: Record<SkillResult, SoundName> = {
  perfect: 'strikePerfect', great: 'strikeGreat', good: 'strikeGood',
  weak: 'strikeWeak', miss: 'strikeMiss',
};
