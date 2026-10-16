import {
  CURRENT_HAMMER_MINI_GAME,
  CURRENT_SOLO_RUN_CONDITIONS,
  FRIEND_RULES_VERSION,
  dailyKey,
  PRACTICE_RULES_VERSION,
  type AsyncMatchRound,
  type MyRunOutcome,
  type Opponent,
  type Question,
  type SoloLeaderboardEntry,
  type SoloLeaderboardStanding,
  type SoloRunResult,
} from '@clutch/shared';
import { currentMiniGameConfigJson } from './repository';
import { findTiebreakAnswer } from '../tiebreaker/tiebreakerRepository';

/** Забег стартует с записью соперника как темпом (или без неё); сама запись забег не завершает. */
export async function createSoloRun(db: D1Database, input: {
  id: string;
  playerId: string;
  displayName: string;
  category: string;
  /** Набор запоминается и для тренировки: увиденные вопросы не должны вернуться в зачёте. */
  questionSetId: string | null;
  questions: Question[];
  paceRunId: string | null;
  pace: Opponent | null;
  /** Тренировка против бота: своя версия правил, вне пула, таблицы, приглашений и истории. */
  practice?: boolean;
  /** Забег по дружеской ссылке: своя версия правил, вне пула, таблицы и приглашений; исход считается. */
  friend?: boolean;
  now: number;
}): Promise<void> {
  await db.prepare(`
    INSERT INTO match_runs (
      id, player_id, display_name, category, questions_json, opponent_run_id, created_at,
      rules_version, mini_game_id, mini_game_config_json, opponent_json, question_set_id
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
  `).bind(
    input.id,
    input.playerId,
    input.displayName,
    input.category,
    JSON.stringify(input.questions),
    input.paceRunId,
    input.now,
    input.practice
      ? PRACTICE_RULES_VERSION
      : input.friend ? FRIEND_RULES_VERSION : CURRENT_SOLO_RUN_CONDITIONS.rulesVersion,
    CURRENT_HAMMER_MINI_GAME.id,
    currentMiniGameConfigJson,
    input.pace ? JSON.stringify(input.pace) : null,
    input.questionSetId,
  ).run();
}

export async function completeSoloRun(db: D1Database, input: {
  matchId: string;
  rounds: AsyncMatchRound[];
  progress: number;
  correctCount: number;
  reachedTarget: boolean;
  setPar: number;
  soloScore: number;
  /** Исход против темпа; null — темпа не было, забег ждёт соперника. */
  outcome: MyRunOutcome | null;
  /** Тренировка закрывается без цели, оценки и права стать записью соперника. */
  practice?: boolean;
  /** Дружеская дуэль: результат и исход сохраняются, но забег не может стать записью соперника. */
  friend?: boolean;
  now: number;
}): Promise<boolean> {
  const update = await db.prepare(`
    UPDATE match_runs
    SET rounds_json = ?2, progress = ?3, correct_count = ?4, status = 'completed',
        completed_at = ?5, ghost_eligible = ?6, reached_target = ?10, set_par = ?7, solo_score = ?8,
        solo_outcome = ?9
    WHERE id = ?1 AND status = 'in_progress'
  `).bind(
    input.matchId,
    JSON.stringify(input.rounds),
    input.progress,
    input.correctCount,
    input.now,
    input.practice || input.friend ? 0 : input.reachedTarget ? 1 : 0,
    input.practice ? null : input.setPar,
    input.practice ? null : input.soloScore,
    input.practice ? null : input.outcome,
    input.practice ? null : input.reachedTarget ? 1 : 0,
  ).run();
  return update.meta.changes > 0;
}

/**
 * Исход записи, против которой только что сыграли, глазами её владельца.
 *
 * Без этого исход писался только финиширующему забегу, а строка владельца оставалась с
 * `solo_outcome IS NULL` навсегда — и в «Моих партиях» у него вечно висело «Ждём соперника»,
 * хотя уведомление уже сообщило итог. Пишем только в пустое: запись сравнивают один раз,
 * и повтор не должен переписать уже решённый исход.
 */
export async function settleRecordOutcome(
  db: D1Database,
  runId: string,
  outcome: MyRunOutcome,
): Promise<boolean> {
  const update = await db.prepare(`
    UPDATE match_runs
    SET solo_outcome = ?2
    WHERE id = ?1 AND status = 'completed' AND solo_outcome IS NULL
  `).bind(runId, outcome).run();
  return update.meta.changes > 0;
}

/**
 * Незаконченный зачётный забег игрока, если он есть.
 *
 * Без этого повторный старт создавал НОВЫЙ забег: брошенный занимал набор навсегда
 * (`lastPlayedBySet` считает сыгранной любую строку), игрок уезжал на следующий набор дня,
 * а запись соперника оставалась на прежнем — и встретиться с ней он уже не мог.
 * Тренировка и дружеская дуэль сюда не попадают: у них свои правила и свои строки.
 */
export async function findActiveSoloRun(
  db: D1Database,
  playerId: string,
  category: string,
): Promise<{ id: string } | null> {
  return db.prepare(`
    SELECT id FROM match_runs
    WHERE player_id = ?1 AND category = ?2 AND status = 'in_progress'
      AND rules_version = ?3
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(playerId, category, CURRENT_SOLO_RUN_CONDITIONS.rulesVersion).first<{ id: string }>();
}

/** Сохранённый исход завершённого забега; null — ждёт соперника или забег старше миграции. */
export async function findSoloOutcome(db: D1Database, runId: string): Promise<MyRunOutcome | null> {
  const row = await db.prepare('SELECT solo_outcome FROM match_runs WHERE id = ?1')
    .bind(runId)
    .first<{ solo_outcome: MyRunOutcome | null }>();
  return row?.solo_outcome ?? null;
}

/** Результат записи-темпа для сравнения, вместе с прикидкой её автора. null — запись не завершена или не соло-результат. */
export async function findPaceResult(db: D1Database, runId: string): Promise<SoloRunResult | null> {
  const row = await db.prepare(`
    SELECT player_id, reached_target, progress, solo_score, rounds_json, created_at, completed_at
    FROM match_runs WHERE id = ?1 AND status = 'completed'
  `).bind(runId).first<{
    player_id: string;
    reached_target: number | null;
    progress: number;
    solo_score: number | null;
    rounds_json: string | null;
    created_at: number;
    completed_at: number | null;
  }>();
  if (!row || row.reached_target === null || row.solo_score === null
    || row.completed_at === null || !row.rounds_json) return null;
  let roundsPlayed: number;
  try {
    const rounds = JSON.parse(row.rounds_json) as unknown;
    if (!Array.isArray(rounds)) return null;
    roundsPlayed = rounds.length;
  } catch {
    return null;
  }
  return {
    reachedTarget: row.reached_target === 1,
    progress: row.progress,
    roundsPlayed,
    soloScore: row.solo_score,
    // Сутки набора записи: ответ автора действует на все его забеги этих суток.
    // Вне try: сбой базы не должен выглядеть как «запись непригодна».
    tiebreak: await findTiebreakAnswer(db, row.player_id, dailyKey(row.created_at)),
  };
}

export const SOLO_BOARD_LIMIT = 50;

/**
 * Таблица дня как общий запрос (параметры: ?1 категория, ?2 rules_version, ?3 начало суток,
 * ?4 конец, ?5 ключ суток для прикидки). Один лучший забег на игрока (меньший счёт, меньше кругов,
 * раньше финиш, id). Место — RANK: делят его равные счёт, круги и прикидка «На глазок» дня
 * (меньший множитель выше; без ответа и гость — ниже всех ответивших). Длительность забега
 * не участвует (решение владельца 2026-10-16). Порядок показа внутри места — по времени финиша.
 */
const BOARD_CTE = `
  WITH ranked_runs AS (
    SELECT id, player_id, display_name, solo_score, set_par, completed_at,
           json_array_length(rounds_json) AS rounds_played,
           ROW_NUMBER() OVER (
             PARTITION BY player_id
             ORDER BY solo_score ASC, json_array_length(rounds_json) ASC, completed_at ASC, id ASC
           ) AS player_rank
    FROM match_runs
    WHERE category = ?1 AND status = 'completed' AND rules_version = ?2
      AND reached_target = 1 AND solo_score IS NOT NULL
      AND completed_at >= ?3 AND completed_at < ?4
  ),
  best AS (
    SELECT r.id, r.player_id, r.display_name, r.solo_score, r.set_par, r.completed_at, r.rounds_played,
           CASE WHEN r.player_id LIKE 'telegram:%' THEN t.multiplier END AS multiplier
    FROM ranked_runs r
    LEFT JOIN tiebreaker_answers t ON t.player_id = r.player_id AND t.date_key = ?5
    WHERE r.player_rank = 1
  ),
  placed AS (
    SELECT *,
           RANK() OVER (
             ORDER BY solo_score ASC, rounds_played ASC, COALESCE(multiplier, 1e18) ASC
           ) AS place,
           COUNT(*) OVER () AS total
    FROM best
  )`;

/** Лучший забег каждого игрока за сутки [from, to) по категории: только дошедшие до цели. */
export async function soloLeaderboard(
  db: D1Database,
  category: string,
  rulesVersion: string,
  from: number,
  to: number,
  dateKey: string,
): Promise<SoloLeaderboardEntry[]> {
  const result = await db.prepare(`${BOARD_CTE}
    SELECT place AS rank, display_name AS displayName, solo_score AS soloScore, set_par AS setPar,
           rounds_played AS roundsPlayed, completed_at AS completedAt
    FROM placed
    ORDER BY place ASC, completed_at ASC, id ASC
    LIMIT ?6
  `).bind(category, rulesVersion, from, to, dateKey, SOLO_BOARD_LIMIT).all<SoloLeaderboardEntry>();
  return result.results;
}

/** Строка верха таблицы для сравнения «до/после» в известии «выбили из десятки». */
export interface BoardPlace {
  playerId: string;
  displayName: string;
  place: number;
  soloScore: number;
  roundsPlayed: number;
}

/** Все места не ниже `maxPlace` (с учётом ничьих; потолок строк страхует от гигантской ничьей). */
export async function soloBoardTop(
  db: D1Database,
  category: string,
  rulesVersion: string,
  from: number,
  to: number,
  dateKey: string,
  maxPlace: number,
): Promise<BoardPlace[]> {
  const result = await db.prepare(`${BOARD_CTE}
    SELECT player_id AS playerId, display_name AS displayName, place, solo_score AS soloScore,
           rounds_played AS roundsPlayed
    FROM placed WHERE place <= ?6
    ORDER BY place ASC, completed_at ASC, id ASC
    LIMIT 500
  `).bind(category, rulesVersion, from, to, dateKey, maxPlace).all<BoardPlace>();
  return result.results;
}

/**
 * Место самого игрока в той же таблице, даже если он далеко за топ-50. Запрос тот же, что в
 * `soloLeaderboard`, иначе место не совпадало бы со списком.
 * null — в этот день игрок не закрыл ни одного забега этой категории.
 */
export async function soloStanding(
  db: D1Database,
  category: string,
  rulesVersion: string,
  from: number,
  to: number,
  dateKey: string,
  playerId: string,
): Promise<SoloLeaderboardStanding | null> {
  const row = await db.prepare(`${BOARD_CTE}
    SELECT me.place AS place, me.total AS total, me.display_name AS displayName,
           me.solo_score AS soloScore, me.set_par AS setPar, me.rounds_played AS roundsPlayed,
           me.completed_at AS completedAt, me.multiplier AS multiplier,
           (SELECT a.solo_score FROM placed a WHERE a.place < me.place ORDER BY a.place DESC LIMIT 1) AS nextScore,
           (SELECT a.rounds_played FROM placed a WHERE a.place < me.place ORDER BY a.place DESC LIMIT 1) AS nextRounds,
           (SELECT MAX(a.place) FROM placed a WHERE a.place < me.place) AS placeAbove
    FROM placed me WHERE me.player_id = ?6
  `).bind(category, rulesVersion, from, to, dateKey, playerId).first<{
    place: number;
    total: number;
    displayName: string;
    soloScore: number;
    setPar: number;
    roundsPlayed: number;
    completedAt: number;
    multiplier: number | null;
    nextScore: number | null;
    nextRounds: number | null;
    placeAbove: number | null;
  }>();
  if (!row) return null;
  return {
    rank: row.place,
    total: row.total,
    entry: {
      rank: row.place,
      displayName: row.displayName,
      soloScore: row.soloScore,
      setPar: row.setPar,
      roundsPlayed: row.roundsPlayed,
      completedAt: row.completedAt,
    },
    roundsToNext: roundsToPass(row.roundsPlayed, row.setPar, row.nextScore),
    placeAbove: row.placeAbove,
    // Равны и счёт, и круги — выше его поставила только прикидка.
    outrankedByGuess: row.nextScore !== null && row.nextScore === row.soloScore
      && row.nextRounds === row.roundsPlayed,
    tiebreak: !playerId.startsWith('telegram:') ? 'guest' : row.multiplier === null ? 'not_answered' : 'answered',
  };
}

/**
 * Сколько кругов нужно отыграть, чтобы обойти стоящего выше. Счёт — круги / пар, поэтому разницу
 * счётов надо перевести в круги **своего** набора: пары у наборов дня разные. Нужен счёт строго
 * меньше, чем у соседа, отсюда «−1»; эпсилон съедает погрешность деления.
 */
function roundsToPass(roundsPlayed: number, setPar: number, nextScore: number | null): number | null {
  if (nextScore === null || !Number.isFinite(setPar) || setPar <= 0) return null;
  const target = Math.ceil(nextScore * setPar - 1e-9) - 1;
  return Math.max(1, roundsPlayed - target);
}
