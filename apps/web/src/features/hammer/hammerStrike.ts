import {
  SKILL_REWARDS,
  SOLO_TARGET_PROGRESS,
  pressureStageFromResults,
  type HammerAttemptRules,
  type SkillResult,
} from '@clutch/shared';

type Tier = Exclude<SkillResult, 'miss'>;

export interface HammerZoneLabel {
  result: Tier;
  /** Очки за удар в этой зоне — та самая награда tier, по которой считает сервер. */
  points: number;
  /** Центр подписи на дорожке, в процентах ширины. */
  leftPercent: number;
}

/**
 * Подписи очков над дорожкой. Зоны вложены друг в друга вокруг цели, поэтому подпись tier стоит
 * посередине его кольца — между границей соседней внутренней зоны и своей. Ширины берутся из
 * порогов стадии давления (attempt.thresholds), очки — из SKILL_REWARDS: ничего не хардкодится.
 */
/**
 * Наименьшее расстояние между центрами соседних подписей, доля ширины дорожки. Подпись «+25» занимает около
 * 22 px; на дорожке 320 px (узкий телефон) 7,5% — это 24 px. Кольцо, чья подпись встала бы ближе, остаётся без
 * подписи: чем уже зоны, тем меньше подписей, а подпись центра есть всегда. Правила зон это не меняет.
 */
export const MIN_ZONE_LABEL_GAP = 0.075;

export function hammerZoneLabels(attempt: HammerAttemptRules): readonly HammerZoneLabel[] {
  const { thresholds, targetCenter } = attempt;
  const labels: HammerZoneLabel[] = [
    { result: 'perfect', points: SKILL_REWARDS.perfect, leftPercent: targetCenter * 100 },
  ];
  const rings: ReadonlyArray<readonly [Tier, number]> = [
    ['great', thresholds.perfect],
    ['good', thresholds.great],
    ['weak', thresholds.good],
  ];
  // Кольцо tier — от внутреннего порога до своего; ширина зоны = порог, значит полуширина = порог / 2.
  const outer: Record<Tier, number> = {
    perfect: thresholds.perfect,
    great: thresholds.great,
    good: thresholds.good,
    weak: thresholds.weak,
  };
  let lastShown = 0;
  for (const [result, inner] of rings) {
    const middle = (inner + outer[result]) / 4;
    if (middle - lastShown < MIN_ZONE_LABEL_GAP) continue;
    lastShown = middle;
    labels.unshift({ result, points: SKILL_REWARDS[result], leftPercent: (targetCenter - middle) * 100 });
    labels.push({ result, points: SKILL_REWARDS[result], leftPercent: (targetCenter + middle) * 100 });
  }
  return labels;
}

export interface StrikeGain {
  /** Новый процент игрока сразу после удара (не выше цели забега). */
  total: number;
  /** Реальный прирост на полосе: у цели он может быть меньше награды tier. */
  gain: number;
  /** Сколько осталось до цели; 0 — цель достигнута. */
  remaining: number;
}

export function strikeGain(before: number, reward: number, target = SOLO_TARGET_PROGRESS): StrikeGain {
  const base = Math.min(target, Math.max(0, before));
  const total = Math.min(target, base + Math.max(0, reward));
  return { total, gain: total - base, remaining: target - total };
}

/** «До 100% — ещё N%»; на цели — честное сообщение о завершении, без «ещё 0%». */
export function remainingText(remaining: number, target = SOLO_TARGET_PROGRESS): string {
  return remaining > 0 ? `До ${target}% — ещё ${remaining}%` : `Цель ${target}% достигнута`;
}

/**
 * Строка серии, если этот удар поднял стадию давления. Стадию считает shared — правило не дублируется.
 * Серия — число удачных ударов подряд в этом забеге (промах стадию не растит).
 */
export function seriesNote(previous: readonly SkillResult[], result: SkillResult): string | null {
  const before = pressureStageFromResults(previous);
  const after = pressureStageFromResults([...previous, result]);
  if (after <= before) return null;
  const streak = [...previous, result].filter((item) => item !== 'miss').length;
  return `Серия ${streak} · зоны стали уже`;
}

export interface StrikeNotes {
  remaining?: string;
  series?: string | null;
}

/** Подписи под результатом: те же shared-правила, что и у HUD (награда tier и стадия давления). */
export function strikeNotes(
  result: SkillResult | null,
  progressBefore: number | undefined,
  previous: readonly SkillResult[],
): StrikeNotes {
  if (!result) return {};
  return {
    remaining: progressBefore === undefined
      ? undefined
      : remainingText(strikeGain(progressBefore, SKILL_REWARDS[result]).remaining),
    series: seriesNote(previous, result),
  };
}
