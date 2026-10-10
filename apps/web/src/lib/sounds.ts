import type { SkillResult } from '@clutch/shared';
import { readSoundEnabled, writeSoundEnabled } from './soundPreference';

const soundFiles = {
  tick: '/sfx/tick.ogg',
  timeout: '/sfx/timeout.ogg',
  correct: '/sfx/correct.ogg',
  incorrect: '/sfx/incorrect.ogg',
  hammerTap: '/sfx/hammer-tap.ogg',
  strikePerfect: '/sfx/strike-perfect.ogg',
  strikeGreat: '/sfx/strike-great.ogg',
  strikeGood: '/sfx/strike-good.ogg',
  strikeWeak: '/sfx/strike-weak.ogg',
  strikeMiss: '/sfx/strike-miss.ogg',
  matchWin: '/sfx/match-win.ogg',
  matchLose: '/sfx/match-lose.ogg',
} as const;

export type SoundName = keyof typeof soundFiles;

const cache = new Map<SoundName, HTMLAudioElement>();

function getAudio(name: SoundName): HTMLAudioElement {
  let audio = cache.get(name);
  if (!audio) {
    audio = new Audio(soundFiles[name]);
    audio.preload = 'auto';
    cache.set(name, audio);
  }
  return audio;
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
  return next;
}

export function subscribeSound(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function playSound(name: SoundName, volume = 1) {
  // Muted: return before any Audio is created, cloned or played.
  if (!isSoundEnabled()) return;
  const base = getAudio(name);
  const instance = base.cloneNode(true) as HTMLAudioElement;
  instance.volume = volume;
  instance.play().catch(() => {});
}

export const strikeSoundFor: Record<SkillResult, SoundName> = {
  perfect: 'strikePerfect',
  great: 'strikeGreat',
  good: 'strikeGood',
  weak: 'strikeWeak',
  miss: 'strikeMiss',
};
