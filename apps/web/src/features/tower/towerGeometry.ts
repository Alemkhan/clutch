import { SKILL_REWARDS, normalizedHammerDistance, type HammerAttemptRules, type SkillResult } from '@clutch/shared';

/**
 * Геометрия «Башни». Математика та же, что у молотка: центр блока = положение маркера, центр верхнего
 * блока башни = центр цели. Блок шириной 0,5 дорожки перекрывает башню ровно на (1 − d), где
 * d = |x − c|·2 — это и есть normalizedHammerDistance, по которой сервер считает награду.
 */
export const BLOCK_WIDTH = 0.5;
/** Дорожка (0..1) занимает эту долю ширины сцены, остальное — поля, чтобы блок в крайних положениях не вылезал. */
export const TRACK_FRACTION = 1 / 1.5;
const TRACK_LEFT_PERCENT = ((1 - TRACK_FRACTION) / 2) * 100;

export const BLOCK_WIDTH_PERCENT = BLOCK_WIDTH * TRACK_FRACTION * 100;

/** Позиция на дорожке (0..1) → процент ширины сцены. */
export function sceneX(trackPosition: number): number {
  return TRACK_LEFT_PERCENT + trackPosition * TRACK_FRACTION * 100;
}

/** Левый край блока с данным центром (позиция на дорожке), процент ширины сцены. */
export function blockLeftPercent(center: number): number {
  return sceneX(center - BLOCK_WIDTH / 2);
}

export interface Piece {
  /** Левый край, процент ширины сцены. */
  left: number;
  /** Ширина, процент ширины сцены. */
  width: number;
}

export interface TowerLanding {
  /** Совпадение с нижним блоком, целые проценты (для подписи). */
  overlapPercent: number;
  /** Часть, оставшаяся на башне; null — блок не лёг (промах). */
  landed: Piece | null;
  /** Отломанная часть, которая падает; null — отламывать нечего. */
  overhang: Piece | null;
  /** Куда падает отломок: -1 влево, 1 вправо. */
  side: -1 | 1;
}

function piece(startTrack: number, endTrack: number): Piece | null {
  const width = (endTrack - startTrack) * TRACK_FRACTION * 100;
  return width > 0.0001 ? { left: sceneX(startTrack), width } : null;
}

/** Куда лёг блок: markerPosition — где его остановил тап, targetCenter — центр верхнего блока башни. */
export function towerLanding(markerPosition: number, targetCenter: number, result: SkillResult): TowerLanding {
  const distance = normalizedHammerDistance(markerPosition, targetCenter);
  const overlapPercent = Math.round((1 - distance) * 100);
  const side = markerPosition >= targetCenter ? 1 : -1;
  const half = BLOCK_WIDTH / 2;
  const blockStart = markerPosition - half;
  const blockEnd = markerPosition + half;
  if (result === 'miss') {
    return { overlapPercent, landed: null, overhang: piece(blockStart, blockEnd), side };
  }
  const towerStart = targetCenter - half;
  const towerEnd = targetCenter + half;
  return {
    overlapPercent,
    landed: piece(Math.max(blockStart, towerStart), Math.min(blockEnd, towerEnd)),
    overhang: side === 1 ? piece(towerEnd, blockEnd) : piece(blockStart, towerStart),
    side,
  };
}

export interface TowerThresholdLabel {
  result: SkillResult;
  /** Порог совпадения в процентах: «≥N%». null у промаха. */
  minOverlap: number | null;
  points: number;
}

/** Подписи порогов под сценой: N = round((1 − порог стадии)·100), очки — SKILL_REWARDS. */
export function towerThresholdLabels(attempt: HammerAttemptRules): readonly TowerThresholdLabel[] {
  const tiers = ['perfect', 'great', 'good', 'weak'] as const;
  return [
    ...tiers.map((result) => ({
      result,
      minOverlap: Math.round((1 - attempt.thresholds[result]) * 100),
      points: SKILL_REWARDS[result],
    })),
    { result: 'miss' as const, minOverlap: null, points: SKILL_REWARDS.miss },
  ];
}

/** Сколько этажей рисуем: основание + удачные удары забега (промах башню не растит). */
export function towerFloorCount(previous: readonly SkillResult[]): number {
  return 1 + previous.filter((result) => result !== 'miss').length;
}
