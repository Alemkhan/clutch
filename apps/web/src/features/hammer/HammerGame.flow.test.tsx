/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_HAMMER_MINI_GAME, SKILL_REWARDS, scoreHammerTap, type SkillResult } from '@clutch/shared';
import { find, mount, type Mounted } from './hammerTestHarness';
import { HammerGame } from './HammerGame';

vi.mock('react', async (importOriginal) => {
  const actual: any = await importOriginal();
  const h = await import('./hammerTestHarness');
  return { ...actual, ...h.hookOverrides };
});
vi.mock('framer-motion', () => ({
  motion: { img: 'img' },
  useReducedMotion: () => false,
}));
const log: string[] = [];
vi.mock('../../platform/sounds', () => ({
  playSound: (name: string) => log.push(`sound:${name}`),
  strikeSoundFor: { perfect: 'p', great: 'g', good: 'o', weak: 'w', miss: 'm' },
}));
vi.mock('../../platform/analytics', () => ({
  analytics: { track: (name: string, data?: unknown) => log.push(`analytics:${name}:${JSON.stringify(data ?? null)}`) },
}));
vi.mock('./preloadImages', () => ({ preloadImages: () => log.push('preload') }));

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const config = CURRENT_HAMMER_MINI_GAME.config;
let frames: Array<((t: number) => void) | undefined>;
let nextFrameId: number;
const pendingFrames = () => frames.filter(Boolean).length;

function runFrame(timestamp: number) {
  const queued = frames.filter(Boolean) as Array<(t: number) => void>;
  frames = [];
  queued.forEach((cb) => cb(timestamp));
}

beforeEach(() => {
  log.length = 0;
  frames = [];
  nextFrameId = 1;
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('document', { hidden: false, addEventListener: () => {}, removeEventListener: () => {} });
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
    frames[nextFrameId] = cb;
    return nextFrameId++;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { delete frames[id]; });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup(extra: Record<string, unknown> = {}, seen = true) {
  if (seen) localStorage.setItem('clutch_hammer_intro_seen_v1', '1');
  const onComplete = vi.fn((...a: unknown[]) => { log.push(`complete:${JSON.stringify(a)}`); });
  const onStrike = vi.fn((...a: unknown[]) => { log.push(`strike:${JSON.stringify(a)}`); });
  const props = { config, questionId: 'q1', previousSkillResults: [] as SkillResult[], onComplete, onStrike, progressBefore: 40, ...extra };
  const view: Mounted = mount(() => ({ type: HammerGame, props }));
  const game = () => find(view.tree(), (n) => n.props.className === 'hammer-game')!;
  const nail = () => find(view.tree(), (n) => n.props.src === '/sprites/nail.png')!;
  return { view, props, onComplete, onStrike, game, nail };
}

describe('HammerGame dynamics', () => {
  it('starts the attempt once and moves the marker frame by frame', () => {
    const { view } = setup();
    expect(log.filter((l) => l.startsWith('analytics:skill_attempt_started'))).toHaveLength(1);
    expect(log).toContain('preload');
    runFrame(1000);
    runFrame(1016);
    view.flush();
    const marker = find(view.tree(), (n) => n.props.className === 'marker')!;
    expect(marker.props.style.left).not.toBe('0%');
    view.unmount();
  });

  it('strike: sound, onStrike preview, delayed strike sound, analytics, then onComplete once with active elapsed', () => {
    const { view, game, nail, onComplete, onStrike } = setup();
    runFrame(1000);
    runFrame(1016);
    runFrame(1032);
    view.flush();
    log.length = 0;

    game().props.onClick();
    view.flush();
    const expected = scoreHammerTap('q1', [], config, 32);
    expect(onStrike).toHaveBeenCalledTimes(1);
    expect(onStrike).toHaveBeenCalledWith(expected.result, expected.progressAwarded);
    expect(log).toEqual([
      'sound:hammerTap',
      `strike:${JSON.stringify([expected.result, expected.progressAwarded])}`,
      `analytics:skill_attempt_completed:${JSON.stringify({ skillResult: expected.result, progressAwarded: expected.progressAwarded })}`,
    ]);
    expect(pendingFrames()).toBe(0);
    expect(onComplete).not.toHaveBeenCalled();
    expect(nail().props.animate).toEqual({ y: expect.any(Number) });
    expect(find(view.tree(), (n) => String(n.props.className).startsWith('strike-result'))).not.toBeNull();

    vi.advanceTimersByTime(149);
    expect(log.some((l) => l.startsWith('sound:') && l !== 'sound:hammerTap')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(log.at(-1)).toMatch(/^sound:/);

    nail().props.onAnimationComplete();
    nail().props.onAnimationComplete();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(expected.result, SKILL_REWARDS[expected.result], 32);

    game().props.onClick();
    expect(onStrike).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('Enter and Space strike with preventDefault; other keys do not', () => {
    const { view, game, onStrike } = setup();
    const preventDefault = vi.fn();
    game().props.onKeyDown({ key: 'a', preventDefault });
    expect(onStrike).not.toHaveBeenCalled();
    game().props.onKeyDown({ key: ' ', preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onStrike).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('does not start or strike while the intro is open, then starts on confirm', () => {
    const { view, game, onStrike } = setup({}, false);
    expect(pendingFrames()).toBe(0);
    expect(log.some((l) => l.startsWith('analytics:skill_attempt_started'))).toBe(false);
    game().props.onClick();
    expect(onStrike).not.toHaveBeenCalled();
    find(view.tree(), (n) => n.props.className === 'hammer-intro-btn')!.props.onClick();
    view.flush();
    expect(localStorage.getItem('clutch_hammer_intro_seen_v1')).toBe('1');
    expect(log.filter((l) => l.startsWith('analytics:skill_attempt_started'))).toHaveLength(1);
    expect(pendingFrames()).toBe(1);
    game().props.onClick();
    expect(onStrike).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});
