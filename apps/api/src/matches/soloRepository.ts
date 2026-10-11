import {
  CURRENT_ASYNC_MATCH_CONDITIONS,
  CURRENT_SOLO_RUN_CONDITIONS,
  FRIEND_RULES_VERSION,
  PRACTICE_RULES_VERSION,
  type AsyncMatchRound,
  type MyRunOutcome,
  type Opponent,
  type Question,
  type SoloLeaderboardEntry,
  type SoloRunResult,
} from '@clutch/shared';
import { currentMiniGameConfigJson } from './repository';

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
    CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.id,
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

/** Сохранённый исход завершённого забега; null — ждёт соперника или забег старше миграции. */
export async function findSoloOutcome(db: D1Database, runId: string): Promise<MyRunOutcome | null> {
  const row = await db.prepare('SELECT solo_outcome FROM match_runs WHERE id = ?1')
    .bind(runId)
    .first<{ solo_outcome: MyRunOutcome | null }>();
  return row?.solo_outcome ?? null;
}

/** Результат записи-темпа для сравнения. null — запись не завершена или не соло-результат. */
export async function findPaceResult(db: D1Database, runId: string): Promise<SoloRunResult | null> {
  const row = await db.prepare(`
    SELECT reached_target, progress, solo_score, rounds_json, created_at, completed_at
    FROM match_runs WHERE id = ?1 AND status = 'completed'
  `).bind(runId).first<{
    reached_target: number | null;
    progress: number;
    solo_score: number | null;
    rounds_json: string | null;
    created_at: number;
    completed_at: number | null;
  }>();
  if (!row || row.reached_target === null || row.solo_score === null
    || row.completed_at === null || !row.rounds_json) return null;
  try {
    const rounds = JSON.parse(row.rounds_json) as unknown;
    if (!Array.isArray(rounds)) return null;
    return {
      reachedTarget: row.reached_target === 1,
      progress: row.progress,
      roundsPlayed: rounds.length,
      soloScore: row.solo_score,
      durationMs: Math.max(0, row.completed_at - row.created_at),
    };
  } catch {
    return null;
  }
}

export const SOLO_BOARD_LIMIT = 50;

/**
 * Лучший забег каждого игрока за сутки [from, to) по категории: только дошедшие до цели,
 * меньший solo_score выше; при равенстве меньше кругов, короче забег, id.
 */
export async function soloLeaderboard(
  db: D1Database,
  category: string,
  rulesVersion: string,
  from: number,
  to: number,
): Promise<SoloLeaderboardEntry[]> {
  const result = await db.prepare(`
    WITH ranked_runs AS (
      SELECT id, display_name, solo_score, set_par, completed_at, completed_at - created_at AS duration_ms,
             json_array_length(rounds_json) AS rounds_played,
             ROW_NUMBER() OVER (
               PARTITION BY player_id
               ORDER BY solo_score ASC, json_array_length(rounds_json) ASC, completed_at - created_at ASC, id ASC
             ) AS player_rank
      FROM match_runs
      WHERE category = ?1 AND status = 'completed' AND rules_version = ?2
        AND reached_target = 1 AND solo_score IS NOT NULL
        AND completed_at >= ?3 AND completed_at < ?4
    )
    SELECT display_name AS displayName, solo_score AS soloScore, set_par AS setPar,
           rounds_played AS roundsPlayed, completed_at AS completedAt
    FROM ranked_runs
    WHERE player_rank = 1
    ORDER BY soloScore ASC, roundsPlayed ASC, duration_ms ASC, id ASC
    LIMIT ?5
  `).bind(category, rulesVersion, from, to, SOLO_BOARD_LIMIT).all<SoloLeaderboardEntry>();
  return result.results;
}
