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

/**
 * Web Audio: один контекст на страницу. iOS (и Telegram на iOS) разрешает каждому `<audio>` играть
 * только из нажатия, поэтому звук победы на экране итога и звуки после ответа сервера там молчали
 * (аналитика: play-rejected у половины игроков). Контекст, разбуженный одним касанием, дальше играет
 * любые звуки без жеста. Нет Web Audio или контекст ещё спит — старый путь через `<audio>`.
 */
type WebAudioContext = AudioContext;
let context: WebAudioContext | null | undefined;
const buffers = new Map<SoundName, Promise<AudioBuffer | null>>();

function audioContext(): WebAudioContext | null {
  if (context !== undefined) return context;
  const Ctor = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  try {
    context = Ctor ? new Ctor() : null;
  } catch {
    context = null;
  }
  return context;
}

/** Старый Safari знает только колбэчную форму decodeAudioData. */
function decode(ctx: WebAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const result = ctx.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
    result?.then(resolve, reject);
  });
}

/** Первая кодировка, которую контекст сумел декодировать; null — ни одной. Кешируется на звук. */
function loadBuffer(ctx: WebAudioContext, name: SoundName): Promise<AudioBuffer | null> {
  let pending = buffers.get(name);
  if (!pending) {
    pending = (async () => {
      for (const source of playableSources(name)) {
        try {
          const response = await fetch(source.src);
          if (!response.ok) continue;
          return await decode(ctx, await response.arrayBuffer());
        } catch {
          // следующая кодировка
        }
      }
      return null;
    })();
    buffers.set(name, pending);
  }
  return pending;
}

/** Играет через Web Audio; false — контекста нет, он спит или звук не декодировался. */
async function playBuffer(name: SoundName, volume: number): Promise<boolean> {
  const ctx = audioContext();
  if (!ctx || ctx.state !== 'running') return false;
  const buffer = await loadBuffer(ctx, name);
  if (!buffer) return false;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = volume;
  source.connect(gain);
  gain.connect(ctx.destination);
  source.start();
  markReady();
  return true;
}

/** Будит контекст. Вызывать прямо из обработчика жеста: resume вне жеста iOS не разрешит. */
async function resumeContext(): Promise<boolean> {
  const ctx = audioContext();
  if (!ctx) return false;
  try {
    // Тихий звук в том же жесте: старый iOS будит контекст только им.
    const silent = ctx.createBufferSource();
    silent.buffer = ctx.createBuffer(1, 1, 22050);
    silent.connect(ctx.destination);
    silent.start();
    await ctx.resume();
  } catch {
    return false;
  }
  if (ctx.state !== 'running') return false;
  markReady();
  // Звуки декодируются заранее: первый удар не ждёт загрузки.
  for (const name of Object.keys(soundSources) as SoundName[]) void loadBuffer(ctx, name);
  return true;
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

export async function playSound(name: SoundName, volume = 1): Promise<boolean> {
  // Muted: return before any Audio is created, cloned or played.
  if (!isSoundEnabled()) return false;
  if (await playBuffer(name, volume)) return true;
  return trySources(name, volume, 'play');
}

export async function unlockSound(): Promise<boolean> {
  if (!isSoundEnabled()) return false;
  if (await resumeContext()) return true;
  return trySources('correct', 0, 'unlock');
}

const UNLOCK_EVENTS = ['touchend', 'pointerup', 'click', 'keydown'] as const;

export function installSoundUnlock(target: Document = document): () => void {
  let removed = false;
  const handleGesture = () => {
    if (!isSoundEnabled()) return;
    void unlockSound().then((unlocked) => { if (unlocked) remove(); });
  };
  // iOS считает разрешающим жестом окончание касания и клик, а не pointerdown: на нём разблокировка
  // отклонялась (unlock-rejected в аналитике).
  const remove = () => {
    if (removed) return;
    removed = true;
    for (const type of UNLOCK_EVENTS) target.removeEventListener(type, handleGesture);
  };
  for (const type of UNLOCK_EVENTS) target.addEventListener(type, handleGesture);
  return remove;
}

// Keeps module-level cache and diagnostics isolated between unit cases.
export function resetSoundsForTests(): void {
  cache.clear();
  buffers.clear();
  context = undefined;
  reportedFailures.clear();
  diagnostic = { state: 'idle' };
}

export const strikeSoundFor: Record<SkillResult, SoundName> = {
  perfect: 'strikePerfect', great: 'strikeGreat', good: 'strikeGood',
  weak: 'strikeWeak', miss: 'strikeMiss',
};
