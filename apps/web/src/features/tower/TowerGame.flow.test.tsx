/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_HAMMER_MINI_GAME, SKILL_REWARDS, scoreHammerTap, type SkillResult } from '@clutch/shared';
import { find, mount, type Mounted } from '../hammer/hammerTestHarness';
import { TowerGame } from './TowerGame';

const reduced = vi.hoisted(() => ({ value: false }));

vi.mock('react', async (importOriginal) => {
  const actual: any = await importOriginal();
  const h = await import('../hammer/hammerTestHarness');
  return { ...actual, ...h.hookOverrides };
});
vi.mock('framer-motion', () => ({
  motion: { div: 'div' },
  useReducedMotion: () => reduced.value,
}));
const log: string[] = [];
vi.mock('../../platform/sounds', () => ({
  playSound: (name: string) => log.push(`sound:${name}`),
  strikeSoundFor: { perfect: 'p', great: 'g', good: 'o', weak: 'w', miss: 'm' },
}));
vi.mock('../../platform/analytics', () => ({
  analytics: { track: (name: string) => log.push(`analytics:${name}`) },
}));

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
  reduced.value = false;
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
  if (seen) localStorage.setItem('clutch_tower_intro_seen_v1', '1');
  const onComplete = vi.fn();
  const onStrike = vi.fn();
  const props = { config, questionId: 'q1', previousSkillResults: [] as SkillResult[], onComplete, onStrike, progressBefore: 40, ...extra };
  const view: Mounted = mount(() => ({ type: TowerGame, props }));
  const game = () => find(view.tree(), (n) => n.props.className === 'tower-game')!;
  const classed = (name: string) => find(view.tree(), (n) => String(n.props.className).includes(name));
  return { view, onComplete, onStrike, game, classed };
}

describe('TowerGame', () => {
  it('moves the block and sends the same active elapsed time as the hammer would', () => {
    const { view, game, classed, onComplete, onStrike } = setup();
    runFrame(1000);
    runFrame(1016);
    runFrame(1032);
    view.flush();
    const before = classed('tower-moving')!.props.style.left;
    runFrame(1048);
    view.flush();
    expect(classed('tower-moving')!.props.style.left).not.toBe(before);

    game().props.onClick();
    view.flush();
    const expected = scoreHammerTap('q1', [], config, 48);
    expect(onStrike).toHaveBeenCalledWith(expected.result, expected.progressAwarded);
    expect(pendingFrames()).toBe(0);
    expect(onComplete).not.toHaveBeenCalled();
    expect(find(view.tree(), (n) => String(n.props.className).startsWith('strike-result'))).not.toBeNull();
    expect(JSON.stringify(view.tree())).toContain('Совпало');

    // Окончание анимации падения — тот же колбэк, что у гвоздя.
    const settler = classed('tower-fragment') ?? classed('tower-landed')!;
    settler.props.onAnimationComplete();
    settler.props.onAnimationComplete();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(expected.result, SKILL_REWARDS[expected.result], 48);
    view.unmount();
  });

  it('freezes on pointerdown before the delayed mobile click and scores only once', () => {
    const { view, game, classed, onComplete, onStrike } = setup();
    runFrame(1000);
    runFrame(1032);
    view.flush();

    game().props.onPointerDown({ button: 0, isPrimary: true, timeStamp: 1040 });
    view.flush();
    const expected = scoreHammerTap('q1', [], config, 40);
    expect(onStrike).toHaveBeenCalledWith(expected.result, expected.progressAwarded);
    expect(onStrike).toHaveBeenCalledTimes(1);
    expect(pendingFrames()).toBe(0);

    // Mobile browsers may dispatch click after pointerdown; the stopped ref makes it a no-op.
    game().props.onClick({ timeStamp: 1120 });
    expect(onStrike).toHaveBeenCalledTimes(1);
    const settler = classed('tower-fragment') ?? classed('tower-landed')!;
    settler.props.onAnimationComplete();
    expect(onComplete).toHaveBeenCalledWith(expected.result, SKILL_REWARDS[expected.result], 40);
    view.unmount();
  });

  it('uses the tower accessibility label and keyboard', () => {
    const { view, game, onStrike } = setup();
    expect(game().props['aria-label']).toBe('Нажми, чтобы уронить блок');
    const preventDefault = vi.fn();
    game().props.onKeyDown({ key: 'Enter', preventDefault });
    expect(onStrike).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('holds the clock and ignores taps while the intro is open', () => {
    const { view, game, onStrike } = setup({}, false);
    expect(pendingFrames()).toBe(0);
    expect(log.some((l) => l === 'analytics:skill_attempt_started')).toBe(false);
    game().props.onClick();
    expect(onStrike).not.toHaveBeenCalled();
    find(view.tree(), (n) => n.props.className === 'hammer-intro-btn')!.props.onClick();
    view.flush();
    expect(localStorage.getItem('clutch_tower_intro_seen_v1')).toBe('1');
    expect(localStorage.getItem('clutch_hammer_intro_seen_v1')).toBeNull();
    expect(pendingFrames()).toBe(1);
    game().props.onClick();
    expect(onStrike).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('under reduced motion shows the result at once and still reports the end of the fall', () => {
    reduced.value = true;
    const { view, game, classed, onComplete } = setup();
    runFrame(1000);
    runFrame(1016);
    view.flush();
    game().props.onClick();
    view.flush();
    const expected = scoreHammerTap('q1', [], config, 16);
    expect(classed('tower-fragment')).toBeNull();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(expected.result, SKILL_REWARDS[expected.result], 16);
    view.unmount();
  });
});
