export type SkillResult = 'perfect' | 'great' | 'good' | 'weak' | 'miss';

export interface MiniGameConfig {
  markerSpeed: number;
  targetWidth: number;
  perfectWidth: number;
  pressure: {
    stageMultipliers: readonly [number, number, number, number];
    maxTargetOffsets: readonly [number, number, number, number];
  };
}

export const SKILL_REWARDS: Record<SkillResult, number> = {
  perfect: 25,
  great: 18,
  good: 12,
  weak: 5,
  miss: 0,
};

/** Maximum normalized distance from the target centre for each non-miss tier. */
export const SKILL_DISTANCE_THRESHOLDS = {
  perfect: 0.15,
  great: 0.35,
  good: 0.65,
  weak: 0.85,
} as const;

export type PressureStage = 0 | 1 | 2 | 3;

export interface HammerThresholds {
  perfect: number;
  great: number;
  good: number;
  weak: number;
}

export interface HammerAttemptRules {
  stage: PressureStage;
  targetCenter: number;
  thresholds: HammerThresholds;
}

export function pressureStageFromResults(results: readonly SkillResult[]): PressureStage {
  return Math.min(3, results.filter((result) => result !== 'miss').length) as PressureStage;
}

export function hammerThresholdsForStage(
  stage: PressureStage,
  config: MiniGameConfig,
): HammerThresholds {
  const multiplier = config.pressure.stageMultipliers[stage];
  return {
    perfect: SKILL_DISTANCE_THRESHOLDS.perfect * multiplier,
    great: SKILL_DISTANCE_THRESHOLDS.great * multiplier,
    good: SKILL_DISTANCE_THRESHOLDS.good * multiplier,
    weak: SKILL_DISTANCE_THRESHOLDS.weak * multiplier,
  };
}

/** Stable FNV-1a hash; Math.random must never affect a match attempt. */
export function stableQuestionHash(questionId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < questionId.length; index += 1) {
    hash ^= questionId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function hammerTargetCenter(
  questionId: string,
  stage: PressureStage,
  config: MiniGameConfig,
): number {
  const normalizedSignedHash = (stableQuestionHash(questionId) / 0xffffffff) * 2 - 1;
  const offset = normalizedSignedHash * config.pressure.maxTargetOffsets[stage];
  const halfWeakZone = hammerThresholdsForStage(stage, config).weak / 2;
  return Math.min(1 - halfWeakZone, Math.max(halfWeakZone, 0.5 + offset));
}

export function hammerAttemptRules(
  questionId: string,
  previousResults: readonly SkillResult[],
  config: MiniGameConfig,
): HammerAttemptRules {
  const stage = pressureStageFromResults(previousResults);
  return {
    stage,
    targetCenter: hammerTargetCenter(questionId, stage, config),
    thresholds: hammerThresholdsForStage(stage, config),
  };
}

export function normalizedHammerDistance(markerPosition: number, targetCenter: number): number {
  if (!Number.isFinite(markerPosition) || !Number.isFinite(targetCenter)) {
    throw new RangeError('Hammer positions must be finite numbers');
  }
  return Math.min(1, Math.max(0, Math.abs(markerPosition - targetCenter) * 2));
}

export function scoreHammerDistance(
  distance: number,
  stage: PressureStage,
  config: MiniGameConfig,
): { result: SkillResult; progressAwarded: number } {
  if (!Number.isFinite(distance) || distance < 0 || distance > 1) {
    throw new RangeError('Skill distance must be between 0 and 1');
  }
  const thresholds = hammerThresholdsForStage(stage, config);
  const result: SkillResult = distance <= thresholds.perfect
    ? 'perfect'
    : distance <= thresholds.great
      ? 'great'
      : distance <= thresholds.good
        ? 'good'
        : distance <= thresholds.weak
          ? 'weak'
          : 'miss';
  return { result, progressAwarded: SKILL_REWARDS[result] };
}

/** Backwards-compatible stage-zero scoring helper. */
export function resultFromDistance(distance: number): SkillResult {
  const thresholds = SKILL_DISTANCE_THRESHOLDS;
  if (distance <= thresholds.perfect) return 'perfect';
  if (distance <= thresholds.great) return 'great';
  if (distance <= thresholds.good) return 'good';
  if (distance <= thresholds.weak) return 'weak';
  return 'miss';
}
