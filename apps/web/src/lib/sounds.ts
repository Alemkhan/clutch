import type { SkillResult } from '@clutch/shared';

const soundFiles = {
  click: '/sfx/click.ogg',
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

export function playSound(name: SoundName, volume = 1) {
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
