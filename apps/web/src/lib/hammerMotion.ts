import type { HammerAttemptRules, SkillResult } from '@clutch/shared';

export const MAX_HAMMER_FRAME_DELTA_MS = 50;

export function reducedMotionMarkerPosition(attempt: HammerAttemptRules): number {
  return attempt.targetCenter;
}

/** Triangle wave moving from 0 to 1 and back. Speed is track units per second. */
export function markerPositionAtElapsed(activeElapsedMs: number, markerSpeed: number): number {
  const phase = ((Math.max(0, activeElapsedMs) / 1000) * markerSpeed) % 2;
  return phase <= 1 ? phase : 2 - phase;
}

/** A hidden tab and an unexpectedly long frame may advance at most one short frame. */
export function cappedFrameDeltaMs(previousTimestamp: number | null, timestamp: number): number {
  if (previousTimestamp === null) return 0;
  return Math.min(Math.max(0, timestamp - previousTimestamp), MAX_HAMMER_FRAME_DELTA_MS);
}

export interface HammerTierZone {
  result: Exclude<SkillResult, 'miss'>;
  leftPercent: number;
  widthPercent: number;
}

/** A normalized distance d maps to a track band whose full width is d. */
export function hammerTierZones(attempt: HammerAttemptRules): readonly HammerTierZone[] {
  return (['weak', 'good', 'great', 'perfect'] as const).map((result) => {
    const width = attempt.thresholds[result];
    return {
      result,
      leftPercent: (attempt.targetCenter - width / 2) * 100,
      widthPercent: width * 100,
    };
  });
}
