import type { HammerAttemptRules, SkillResult } from '@clutch/shared';

export const MAX_HAMMER_FRAME_DELTA_MS = 50;

// Положение маркера живёт в shared: по той же формуле сервер восстанавливает удар из времени
// тапа, и второй реализации здесь быть не должно. Реэкспорт — чтобы импорт остался одним.
export { markerPositionAtElapsed } from '@clutch/shared';

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
