import type { CategoryId, MyRunOutcome } from './index';

/** То, что нужно знать о завершённом соло-забеге, чтобы сравнить его с другим. */
export interface SoloRunResult {
  reachedTarget: boolean;
  /** Достигнутый прогресс; важен, только если цели не достиг никто. */
  progress: number;
  roundsPlayed: number;
  /** rounds / setPar: меньше — лучше. Нормирует разные по трудности наборы. */
  soloScore: number;
  /** Длительность забега (мс): от старта до завершения. Приходит параметром: функция чистая. */
  durationMs: number;
}

function assertFinite(result: SoloRunResult): void {
  for (const value of [result.progress, result.roundsPlayed, result.soloScore, result.durationMs]) {
    if (!Number.isFinite(value)) throw new RangeError('solo run result must contain finite numbers');
  }
  if (result.durationMs < 0) throw new RangeError('solo run duration must not be negative');
}

/** Меньшее значение выигрывает; равенство — null (решает следующий критерий). */
function lower(own: number, other: number): MyRunOutcome | null {
  if (own < other) return 'player';
  if (own > other) return 'opponent';
  return null;
}

/**
 * Исход соло-забега `own` против `other` глазами `own`:
 * 'player' — победа, 'opponent' — поражение, 'tie' — ничья.
 * Дошедший до цели бьёт не дошедшего. Оба дошли: меньший soloScore, затем меньше кругов,
 * затем меньшая длительность забега. Не дошёл никто: больший прогресс, затем меньше кругов, затем ничья.
 */
export function compareSoloRuns(own: SoloRunResult, other: SoloRunResult): MyRunOutcome {
  assertFinite(own);
  assertFinite(other);
  if (own.reachedTarget !== other.reachedTarget) return own.reachedTarget ? 'player' : 'opponent';
  if (own.reachedTarget) {
    return lower(own.soloScore, other.soloScore)
      ?? lower(own.roundsPlayed, other.roundsPlayed)
      ?? lower(own.durationMs, other.durationMs)
      ?? 'tie';
  }
  return lower(other.progress, own.progress)
    ?? lower(own.roundsPlayed, other.roundsPlayed)
    ?? 'tie';
}

/** Исход глазами второй стороны. */
export function invertOutcome(outcome: MyRunOutcome): MyRunOutcome {
  if (outcome === 'player') return 'opponent';
  if (outcome === 'opponent') return 'player';
  return 'tie';
}

/** Строка таблицы результатов соло за сутки. */
export interface SoloLeaderboardEntry {
  displayName: string;
  soloScore: number;
  setPar: number;
  roundsPlayed: number;
  completedAt: number;
}

export interface SoloLeaderboardResponse {
  category: CategoryId;
  /** Сутки по UTC, YYYY-MM-DD. */
  dateKey: string;
  entries: SoloLeaderboardEntry[];
}
