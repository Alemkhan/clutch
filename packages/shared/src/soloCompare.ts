import type { CategoryId, MyRunOutcome } from './index';
import { resolveTiebreak, type TiebreakAnswer } from './tiebreaker';

/** То, что нужно знать о завершённом соло-забеге, чтобы сравнить его с другим. */
export interface SoloRunResult {
  reachedTarget: boolean;
  /** Достигнутый прогресс; важен, только если цели не достиг никто. */
  progress: number;
  roundsPlayed: number;
  /** rounds / setPar: меньше — лучше. Нормирует разные по трудности наборы. */
  soloScore: number;
  /**
   * Прикидка «На глазок» этой стороны за сутки её набора; null — не отвечала или не засчитывается.
   * Приходит параметром: функция чистая, базу не читает.
   */
  tiebreak: TiebreakAnswer | null;
}

function assertFinite(result: SoloRunResult): void {
  for (const value of [result.progress, result.roundsPlayed, result.soloScore]) {
    if (!Number.isFinite(value)) throw new RangeError('solo run result must contain finite numbers');
  }
}

/** Меньшее значение выигрывает; равенство — null (решает следующий критерий). */
function lower(own: number, other: number): MyRunOutcome | null {
  if (own < other) return 'player';
  if (own > other) return 'opponent';
  return null;
}

/** Исход сравнения и то, решила ли его прикидка «На глазок» (а не счёт, круги или прогресс). */
export interface SoloComparison {
  outcome: MyRunOutcome;
  /** true — счёт/круги/прогресс сравнялись, и победителя назвала прикидка. Ничья по прикидке — false. */
  byTiebreak: boolean;
}

/**
 * Исход соло-забега `own` против `other` глазами `own`:
 * 'player' — победа, 'opponent' — поражение, 'tie' — ничья.
 * Дошедший до цели бьёт не дошедшего. Оба дошли: меньший soloScore, затем меньше кругов.
 * Не дошёл никто: больший прогресс, затем меньше кругов. Если и это равно — «На глазок»
 * (`resolveTiebreak`), и только если прикидки не развели стороны — ничья.
 *
 * Длительность забега исход не решает (решение владельца 2026-10-15). Правило действует
 * с забегов, завершённых после этой даты: исход уже сыгранных хранится в базе и задним числом
 * не пересчитывается; `rulesVersion` не менялась.
 */
export function compareSoloRunsDetailed(own: SoloRunResult, other: SoloRunResult): SoloComparison {
  assertFinite(own);
  assertFinite(other);
  if (own.reachedTarget !== other.reachedTarget) {
    return { outcome: own.reachedTarget ? 'player' : 'opponent', byTiebreak: false };
  }
  const byRun = own.reachedTarget
    ? lower(own.soloScore, other.soloScore) ?? lower(own.roundsPlayed, other.roundsPlayed)
    : lower(other.progress, own.progress) ?? lower(own.roundsPlayed, other.roundsPlayed);
  if (byRun) return { outcome: byRun, byTiebreak: false };
  const outcome = resolveTiebreak(own.tiebreak, other.tiebreak);
  return { outcome, byTiebreak: outcome !== 'tie' };
}

/** Исход без пометки о прикидке; см. `compareSoloRunsDetailed`. */
export function compareSoloRuns(own: SoloRunResult, other: SoloRunResult): MyRunOutcome {
  return compareSoloRunsDetailed(own, other).outcome;
}

/** Исход глазами второй стороны. */
export function invertOutcome(outcome: MyRunOutcome): MyRunOutcome {
  if (outcome === 'player') return 'opponent';
  if (outcome === 'opponent') return 'player';
  return 'tie';
}

/** Строка таблицы результатов соло за сутки. */
export interface SoloLeaderboardEntry {
  /**
   * Место в таблице дня. Ничья делит место: равные круги и равная прикидка «На глазок» (или оба без
   * неё) дают один номер, нумерация соревновательная (1, 2, 2, 4).
   */
  rank: number;
  displayName: string;
  soloScore: number;
  setPar: number;
  roundsPlayed: number;
  completedAt: number;
}

/**
 * Место самого игрока. Без него таблица топ-50 ничего не говорит тому, кто в неё не попал:
 * цель «обойти стоящего выше на один круг» достижима, а «попасть в топ-50» — нет.
 */
export interface SoloLeaderboardStanding {
  /** Место в таблице дня, начиная с 1; общее у ничьих (1, 2, 2, 4). */
  rank: number;
  /** Сколько всего игроков в таблице дня: «37-й из 140». */
  total: number;
  entry: SoloLeaderboardEntry;
  /**
   * На сколько кругов нужно улучшиться, чтобы обойти стоящего выше. Считается по пару своего
   * набора, поэтому это настоящее число кругов, а не разница счётов. null — игрок первый.
   */
  roundsToNext: number | null;
  /** Место ближайшего стоящего строго выше (при ничьих это не `rank - 1`). null — игрок первый. */
  placeAbove: number | null;
  /**
   * Ближайший стоящий выше имеет те же круги: обошёл он только прикидкой «На глазок», так что
   * `roundsToNext` здесь ничего не объясняет.
   */
  outrankedByGuess: boolean;
  /**
   * Прикидка дня для этого игрока: `answered` — засчитана, `not_answered` — Telegram-игрок ещё не
   * ответил, `guest` — гостю прикидка не засчитывается никогда.
   */
  tiebreak: 'answered' | 'not_answered' | 'guest';
}

export interface SoloLeaderboardResponse {
  category: CategoryId;
  /** Сутки игры, YYYY-MM-DD; граница сдвинута от UTC на `DAY_BOUNDARY_OFFSET_MINUTES`. */
  dateKey: string;
  entries: SoloLeaderboardEntry[];
  /** Своё место. null — в этот день игрок не закрыл ни одного забега в этой категории. */
  you: SoloLeaderboardStanding | null;
}
