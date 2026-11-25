import {
  achievementsOf,
  DAILY_RULES_VERSION,
  dailyKey,
  DUEL_RULES_VERSION,
  experienceOf,
  FREE_RULES_VERSION,
  levelFromXp,
  PRACTICE_RULES_VERSION,
  streakFromDays,
  type PlayerStats,
  type PlayerStreak,
  type SoloProfileResponse,
} from '@clutch/shared';

interface SoloProfileRow {
  completed_runs: number;
  reached_target_runs: number;
  best_rounds: number | null;
}

interface CountersRow {
  correct_answers: number;
  duel_wins: number;
  tiebreaker_answers: number;
  wiki_paths: number;
  wiki_given_up: number;
  group_challenges: number;
  friend_invites: number;
}

/**
 * Игровые сутки, в которые игрок начинал забег дня. День берётся из id набора
 * (`general:2026-11-14:0`), а не из времени старта: так он совпадает с таблицей дня.
 */
export async function dailyRunDays(db: D1Database, playerId: string): Promise<string[]> {
  const { results } = await db.prepare(`
    SELECT DISTINCT substr(question_set_id, instr(question_set_id, ':') + 1, 10) AS day
    FROM match_runs
    WHERE player_id = ?1 AND rules_version = ?2 AND question_set_id IS NOT NULL
  `).bind(playerId, DAILY_RULES_VERSION).all<{ day: string }>();
  return results.map((row) => row.day).filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day));
}

export async function playerStreak(db: D1Database, playerId: string, now = Date.now()): Promise<PlayerStreak> {
  return streakFromDays(await dailyRunDays(db, playerId), dailyKey(now));
}

/**
 * Статистика профиля — только зачётные забеги текущей версии правил. Тренировки, дружеские дуэли,
 * строки других версий правил и незаконченные строки не становятся статистикой. Опыт и достижения
 * учитывают и дружеские забеги (верные ответы там настоящие), но не тренировку с ботом.
 */
export async function getSoloProfile(
  db: D1Database,
  playerId: string,
  now = Date.now(),
): Promise<SoloProfileResponse> {
  const [row, counters, days] = await Promise.all([
    db.prepare(`
      SELECT
        COUNT(*) AS completed_runs,
        COALESCE(SUM(CASE WHEN reached_target = 1 THEN 1 ELSE 0 END), 0) AS reached_target_runs,
        MIN(CASE WHEN reached_target = 1 THEN json_array_length(rounds_json) END) AS best_rounds
      FROM match_runs
      WHERE player_id = ?1 AND status = 'completed' AND completed_at IS NOT NULL
        AND rules_version IN (?2, ?3, ?4)
    `).bind(playerId, DAILY_RULES_VERSION, FREE_RULES_VERSION, DUEL_RULES_VERSION).first<SoloProfileRow>(),
    db.prepare(`
      SELECT
        (SELECT COALESCE(SUM(correct_count), 0) FROM match_runs
          WHERE player_id = ?1 AND rules_version != ?2) AS correct_answers,
        (SELECT COUNT(*) FROM match_runs
          WHERE player_id = ?1 AND rules_version = ?3 AND solo_outcome = 'player') AS duel_wins,
        (SELECT COUNT(*) FROM tiebreaker_answers WHERE player_id = ?1) AS tiebreaker_answers,
        (SELECT COUNT(*) FROM wiki_path_runs WHERE player_id = ?1 AND status = 'completed') AS wiki_paths,
        (SELECT COUNT(*) FROM wiki_path_runs WHERE player_id = ?1 AND gave_up_at IS NOT NULL) AS wiki_given_up,
        (SELECT COUNT(*) FROM group_challenges WHERE creator_player_id = ?1) AS group_challenges,
        (SELECT COUNT(*) FROM rematch_invites i JOIN match_runs r ON r.id = i.challenger_run_id
          WHERE r.player_id = ?1) AS friend_invites
    `).bind(playerId, PRACTICE_RULES_VERSION, DUEL_RULES_VERSION).first<CountersRow>(),
    dailyRunDays(db, playerId),
  ]);

  const streak = streakFromDays(days, dailyKey(now));
  const stats: PlayerStats = {
    completedRuns: row?.completed_runs ?? 0,
    reachedTargetRuns: row?.reached_target_runs ?? 0,
    bestRounds: row?.best_rounds ?? null,
    correctAnswers: counters?.correct_answers ?? 0,
    duelWins: counters?.duel_wins ?? 0,
    tiebreakerAnswers: counters?.tiebreaker_answers ?? 0,
    wikiPathsCompleted: counters?.wiki_paths ?? 0,
    wikiPathsGivenUp: counters?.wiki_given_up ?? 0,
    friendChallenges: (counters?.group_challenges ?? 0) + (counters?.friend_invites ?? 0),
    bestStreak: streak.best,
  };

  return {
    completedRuns: stats.completedRuns,
    reachedTargetRuns: stats.reachedTargetRuns,
    bestRounds: stats.bestRounds,
    streak,
    level: levelFromXp(experienceOf(stats)),
    achievements: achievementsOf(stats),
  };
}
