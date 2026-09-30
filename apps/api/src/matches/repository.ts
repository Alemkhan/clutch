import { CURRENT_ASYNC_MATCH_CONDITIONS, type AsyncMatchRound, type Opponent, type Question } from '@clutch/shared';
import type { RunRow } from './types';
import { candidateSnapshot } from './validation';

export const currentMiniGameConfigJson = JSON.stringify(
  CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.config,
);

const runColumns = `
  id, player_id, display_name, questions_json, rounds_json, progress, correct_count, status,
  rules_version, mini_game_id, mini_game_config_json, opponent_json, ghost_eligible`;

export interface GhostMatch {
  row: RunRow;
  questions: Question[];
  opponent: Opponent;
}

export async function findGhost(
  db: D1Database,
  category: string,
  playerId: string,
): Promise<GhostMatch | null> {
  const select = `
    SELECT ${runColumns}
    FROM match_runs
    WHERE category = ?1
      AND status = 'completed'
      AND ghost_eligible = 1
      AND rules_version = ?3
      AND mini_game_id = ?4
      AND mini_game_config_json = ?5
      AND player_id <> ?2`;
  const queries = [
    `${select}
      AND id NOT IN (
        SELECT opponent_run_id FROM match_runs
        WHERE player_id = ?2 AND opponent_run_id IS NOT NULL
      )
      ORDER BY completed_at DESC LIMIT 20`,
    `${select} ORDER BY completed_at DESC LIMIT 20`,
  ];

  for (const query of queries) {
    const result = await db.prepare(query).bind(
      category,
      playerId,
      CURRENT_ASYNC_MATCH_CONDITIONS.rulesVersion,
      CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.id,
      currentMiniGameConfigJson,
    ).all<RunRow>();
    for (const row of result.results) {
      const snapshot = candidateSnapshot(row);
      if (snapshot) return { row, ...snapshot };
    }
  }
  return null;
}

export async function createMatchRun(db: D1Database, input: {
  id: string;
  playerId: string;
  displayName: string;
  category: string;
  questions: Question[];
  opponentRunId: string | null;
  opponent: Opponent;
}): Promise<void> {
  await db.prepare(`
    INSERT INTO match_runs (
      id, player_id, display_name, category, questions_json, opponent_run_id, created_at,
      rules_version, mini_game_id, mini_game_config_json, opponent_json
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
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
