import { CURRENT_ASYNC_MATCH_CONDITIONS, MIN_POOL_ROUNDS, type AsyncMatchRound, type Opponent, type Question } from '@clutch/shared';
import type { RunRow } from './types';
import { candidateSnapshot } from './validation';

export const currentMiniGameConfigJson = JSON.stringify(
  CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.config,
);

const runColumns = `
  id, player_id, display_name, questions_json, rounds_json, progress, correct_count, status,
  rules_version, mini_game_id, mini_game_config_json, opponent_json, ghost_eligible, opponent_run_id,
  created_at`;

/** Какой пул соперников: версия правил и (для соло) только забеги, дошедшие до цели. */
export interface PoolOptions {
  rulesVersion?: string;
  reachedTargetOnly?: boolean;
}

export interface GhostMatch {
  row: RunRow;
  questionSetId: string;
  questions: Question[];
  opponent: Opponent;
}

/**
 * One query over the whole day's bank: the freshest finished run of another player, with at
 * least MIN_POOL_ROUNDS played rounds, that this player has not faced yet. Its set is the set
 * to play. With unplayedSetsOnly the run must also sit on a set this player never started,
 * so a live opponent is never bought with repeated questions. Whether the run reached 100 is irrelevant for the race pool: ghost_eligible is not a filter; the solo pool filters reached_target.
 * There is deliberately no fallback that drops the "already faced" condition.
 */
export async function findGhostInSets(
  db: D1Database,
  questionSetIds: readonly string[],
  playerId: string,
  options: PoolOptions & { unplayedSetsOnly?: boolean } = {},
): Promise<GhostMatch | null> {
  if (questionSetIds.length === 0) return null;
  // "Played" means any run of the set by this player, whatever its status.
  const unplayedClause = options.unplayedSetsOnly ? `
      AND question_set_id NOT IN (
        SELECT question_set_id FROM match_runs
        WHERE player_id = ?2 AND question_set_id IS NOT NULL
      )` : '';
  const reachedClause = options.reachedTargetOnly ? ' AND reached_target = 1' : '';
  const setPlaceholders = questionSetIds.map((_, index) => `?${index + 6}`).join(', ');
  const result = await db.prepare(`
    SELECT ${runColumns}, question_set_id
    FROM match_runs
    WHERE question_set_id IN (${setPlaceholders})
      AND status = 'completed'
      AND CASE WHEN json_valid(rounds_json) THEN json_array_length(rounds_json) ELSE 0 END >= ?1
      AND rules_version = ?3
      AND mini_game_id = ?4
      AND mini_game_config_json = ?5
      AND player_id <> ?2
      AND id NOT IN (
        SELECT opponent_run_id FROM match_runs
        WHERE player_id = ?2 AND opponent_run_id IS NOT NULL
      )${unplayedClause}${reachedClause}
    ORDER BY completed_at DESC LIMIT 20
  `).bind(
    MIN_POOL_ROUNDS,
    playerId,
    options.rulesVersion ?? CURRENT_ASYNC_MATCH_CONDITIONS.rulesVersion,
    CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.id,
    currentMiniGameConfigJson,
    ...questionSetIds,
  ).all<RunRow>();
  for (const row of result.results) {
    const snapshot = candidateSnapshot(row);
    if (snapshot && row.question_set_id) {
      return { row, questionSetId: row.question_set_id, ...snapshot };
    }
  }
  return null;
}

/** Owner and category of a stored run, for the outbid notification. */
export async function findRunOwner(
  db: D1Database,
  runId: string,
): Promise<{ id: string; playerId: string; category: string } | null> {
  const row = await db.prepare('SELECT id, player_id, category FROM match_runs WHERE id = ?1')
    .bind(runId)
    .first<{ id: string; player_id: string; category: string }>();
  return row ? { id: row.id, playerId: row.player_id, category: row.category } : null;
}

/** When this player last started each of the given sets (any status), by set id. */
export async function lastPlayedBySet(
  db: D1Database,
  questionSetIds: readonly string[],
  playerId: string,
): Promise<Map<string, number>> {
  const placeholders = questionSetIds.map((_, index) => `?${index + 2}`).join(', ');
  const result = await db.prepare(`
    SELECT question_set_id, MAX(created_at) AS last_played
    FROM match_runs
    WHERE player_id = ?1 AND question_set_id IN (${placeholders})
    GROUP BY question_set_id
  `).bind(playerId, ...questionSetIds).all<{ question_set_id: string; last_played: number }>();
  return new Map(result.results.map((row) => [row.question_set_id, row.last_played]));
}

export async function createMatchRun(db: D1Database, input: {
  id: string;
  playerId: string;
  displayName: string;
  category: string;
  questionSetId: string;
  questions: Question[];
  opponentRunId: string | null;
  opponent: Opponent;
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
    input.opponentRunId,
    Date.now(),
    CURRENT_ASYNC_MATCH_CONDITIONS.rulesVersion,
    CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.id,
    currentMiniGameConfigJson,
    JSON.stringify(input.opponent),
    input.questionSetId,
  ).run();
}

export async function findRun(db: D1Database, matchId: string): Promise<RunRow | null> {
  return db.prepare(`SELECT ${runColumns} FROM match_runs WHERE id = ?1`)
    .bind(matchId)
    .first<RunRow>();
}

export async function completeRun(db: D1Database, input: {
  matchId: string;
  rounds: AsyncMatchRound[];
  progress: number;
  correctCount: number;
  ghostEligible: boolean;
}): Promise<boolean> {
  const update = await db.prepare(`
    UPDATE match_runs
    SET rounds_json = ?2, progress = ?3, correct_count = ?4,
        status = 'completed', completed_at = ?5, ghost_eligible = ?6
    WHERE id = ?1 AND status = 'in_progress'
  `).bind(
    input.matchId,
    JSON.stringify(input.rounds),
    input.progress,
    input.correctCount,
    Date.now(),
    input.ghostEligible ? 1 : 0,
  ).run();
  return update.meta.changes > 0;
}
