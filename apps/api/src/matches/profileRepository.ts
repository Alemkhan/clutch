import { CURRENT_SOLO_RUN_CONDITIONS, type SoloProfileResponse } from '@clutch/shared';

interface SoloProfileRow {
  completed_runs: number;
  reached_target_runs: number;
  best_rounds: number | null;
}

/**
 * Только зачётные забеги текущей версии правил. Тренировки, дружеские дуэли,
 * legacy-гонки и незаконченные строки не становятся статистикой профиля.
 */
export async function getSoloProfile(
  db: D1Database,
  playerId: string,
): Promise<SoloProfileResponse> {
  const row = await db.prepare(`
    SELECT
      COUNT(*) AS completed_runs,
      COALESCE(SUM(CASE WHEN reached_target = 1 THEN 1 ELSE 0 END), 0) AS reached_target_runs,
      MIN(CASE WHEN reached_target = 1 THEN json_array_length(rounds_json) END) AS best_rounds
    FROM match_runs
    WHERE player_id = ?1 AND status = 'completed' AND completed_at IS NOT NULL
      AND rules_version = ?2
  `).bind(playerId, CURRENT_SOLO_RUN_CONDITIONS.rulesVersion).first<SoloProfileRow>();

  return {
    completedRuns: row?.completed_runs ?? 0,
    reachedTargetRuns: row?.reached_target_runs ?? 0,
    bestRounds: row?.best_rounds ?? null,
  };
}
