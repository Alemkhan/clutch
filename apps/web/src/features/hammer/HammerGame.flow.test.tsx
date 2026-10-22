/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_HAMMER_MINI_GAME, SKILL_REWARDS, hammerAttemptRules, markerPositionAtElapsed, scoreHammerTap, type SkillResult } from '@clutch/shared';
import { find, mount, type Mounted } from './hammerTestHarness';
import { HammerGame } from './HammerGame';
import { nailDepthAfter, nailOffset } from './HammerScene';

vi.mock('react', async (importOriginal) => {
  const actual: any = await importOriginal();
  const h = await import('./hammerTestHarness');
  return { ...actual, ...h.hookOverrides };
});
const reduced = vi.hoisted(() => ({ value: false }));
vi.mock('framer-motion', () => ({
  motion: { g: 'g' },
  useReducedMotion: () => reduced.value,
}));
const log: string[] = [];
vi.mock('../../platform/sounds', () => ({
  playSound: (name: string) => log.push(`sound:${name}`),
  strikeSoundFor: { perfect: 'p', great: 'g', good: 'o', weak: 'w', miss: 'm' },
}));
vi.mock('../../platform/analytics', () => ({
  analytics: { track: (name: string, data?: unknown) => log.push(`analytics:${name}:${JSON.stringify(data ?? null)}`) },
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
  if (seen) localStorage.setItem('clutch_hammer_intro_seen_v1', '1');
  const onComplete = vi.fn((...a: unknown[]) => { log.push(`complete:${JSON.stringify(a)}`); });
  const onStrike = vi.fn((...a: unknown[]) => { log.push(`strike:${JSON.stringify(a)}`); });
  const props = { config, questionId: 'q1', previousSkillResults: [] as SkillResult[], onComplete, onStrike, progressBefore: 40, ...extra };
  const view: Mounted = mount(() => ({ type: HammerGame, props }));
  const game = () => find(view.tree(), (n) => n.props.className === 'hammer-game')!;
  const nail = () => find(view.tree(), (n) => n.props.className === 'hammer-nail')!;
  return { view, props, onComplete, onStrike, game, nail };
}

describe('HammerGame dynamics', () => {
  it('starts the attempt once and moves the marker frame by frame', () => {
    const { view } = setup();
    expect(log.filter((l) => l.startsWith('analytics:skill_attempt_started'))).toHaveLength(1);
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
    expect(nail().props.animate).toEqual({ y: nailOffset(nailDepthAfter(40, expected.progressAwarded)) });
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

  it('freezes at pointerdown between frames and sends that exact elapsed once', () => {
    const { view, game, nail, onComplete, onStrike } = setup();
    runFrame(1000);
    runFrame(1032);
    view.flush();
    const marker = () => find(view.tree(), (n) => n.props.className === 'marker')!;
    const speed = hammerAttemptRules('q1', [], config).markerSpeed;
    expect(marker().props.style.left).toBe(`${markerPositionAtElapsed(32, speed) * 100}%`);

    game().props.onPointerDown({ button: 0, isPrimary: true, timeStamp: 1040 });
    view.flush();
    const frozenLeft = `${markerPositionAtElapsed(40, speed) * 100}%`;
    expect(marker().props.style.left).toBe(frozenLeft);
    expect(onStrike).toHaveBeenCalledWith(scoreHammerTap('q1', [], config, 40).result, scoreHammerTap('q1', [], config, 40).progressAwarded);
    expect(pendingFrames()).toBe(0);

    game().props.onClick({ timeStamp: 1100 });
    game().props.onPointerDown({ button: 0, isPrimary: true, timeStamp: 1101 });
    runFrame(1102);
    view.flush();
    expect(marker().props.style.left).toBe(frozenLeft);
    expect(onStrike).toHaveBeenCalledTimes(1);
    nail().props.onAnimationComplete();
    expect(onComplete).toHaveBeenCalledWith(scoreHammerTap('q1', [], config, 40).result, SKILL_REWARDS[scoreHammerTap('q1', [], config, 40).result], 40);
    expect(onComplete).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('ignores secondary pointers and caps time across a delayed frame', () => {
    const { view, game, nail, onComplete, onStrike } = setup();
    runFrame(1000);
    runFrame(1016);
    view.flush();
    game().props.onPointerDown({ button: 2, isPrimary: true, timeStamp: 1020 });
    game().props.onPointerDown({ button: 0, isPrimary: false, timeStamp: 1020 });
    expect(onStrike).not.toHaveBeenCalled();
    game().props.onPointerDown({ button: 0, isPrimary: true, timeStamp: 2000 });
    view.flush();
    expect(onStrike).toHaveBeenCalledTimes(1);
    nail().props.onAnimationComplete();
    expect(onComplete.mock.calls[0][2]).toBe(66);
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

  it('uses keyboard event time between frames', () => {
    const { view, game, nail, onComplete } = setup();
    runFrame(1000);
    runFrame(1016);
    view.flush();
    game().props.onKeyDown({ key: 'Enter', timeStamp: 1024, preventDefault: vi.fn() });
    view.flush();
    nail().props.onAnimationComplete();
    expect(onComplete.mock.calls[0][2]).toBe(24);
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

  it('nail depth follows progressBefore before the strike and the real gain after it', () => {
    const { view, game, nail } = setup({ progressBefore: 40 });
    runFrame(1000);
    runFrame(1016);
    view.flush();
    expect(nail().props.animate).toEqual({ y: nailOffset(40) });
    game().props.onClick();
    view.flush();
    const award = scoreHammerTap('q1', [], config, 16).progressAwarded;
    expect(nail().props.animate).toEqual({ y: nailOffset(40 + award) });
    expect(nailOffset(40 + award)).toBeGreaterThanOrEqual(nailOffset(40));
    view.unmount();
  });

  it('caps the nail at 100% and marks the real (smaller) gain', () => {
    // Берём момент удара, дающий максимальную награду, чтобы прирост у цели точно был урезан.
    let frameCount = 1;
    while (scoreHammerTap('q1', [], config, frameCount * 16).progressAwarded < SKILL_REWARDS.perfect) frameCount += 1;
    const { view, game, nail } = setup({ progressBefore: 98 });
    for (let i = 0; i <= frameCount; i += 1) runFrame(1000 + i * 16);
    view.flush();
    game().props.onClick();
    view.flush();
    expect(nail().props.animate).toEqual({ y: nailOffset(100) });
    const mark = find(view.tree(), (n) => n.props['data-testid'] === 'gain-mark')!;
    expect(JSON.stringify(mark.children)).toContain('"+"');
    expect(JSON.stringify(mark.children)).toContain('2');
    expect(JSON.stringify(mark.children)).not.toContain('25');
    expect(JSON.stringify(view.tree())).toContain('Гвоздь вошёл на 100%');
    view.unmount();
  });

  it('without progressBefore the nail stays put and no gain mark is drawn', () => {
    const { view, game, nail } = setup({ progressBefore: undefined });
    runFrame(1000);
    runFrame(1016);
    view.flush();
    expect(nail().props.animate).toEqual({ y: 0 });
    game().props.onClick();
    view.flush();
    expect(nail().props.animate).toEqual({ y: 0 });
    expect(find(view.tree(), (n) => n.props['data-testid'] === 'gain-mark')).toBeNull();
    view.unmount();
  });

  it('reduced motion: no swing or flash, nail goes straight to depth and the round still completes', () => {
    reduced.value = true;
    const { view, game, nail, onComplete } = setup();
    runFrame(1000);
    runFrame(1016);
    view.flush();
    game().props.onClick();
    view.flush();
    const expected = scoreHammerTap('q1', [], config, 16);
    expect(find(view.tree(), (n) => n.props['data-testid'] === 'impact')).toBeNull();
    expect(find(view.tree(), (n) => n.props.className === 'hammer-tool')!.props.style.transition).toBe('none');
    expect(nail().props.transition.duration).toBe(0);
    expect(nail().props.animate).toEqual({ y: nailOffset(nailDepthAfter(40, expected.progressAwarded)) });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(expected.result, SKILL_REWARDS[expected.result], 16);
    view.unmount();
  });

  it('completes the round after a strike that does not move the nail (miss)', () => {
    const { view, game, onComplete } = setup({ progressBefore: 100 });
    runFrame(1000);
    runFrame(1016);
    view.flush();
    game().props.onClick();
    view.flush();
    expect(onComplete).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(onComplete).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});
