import { LAST_STAND_MAX_ROUNDS, type RecordedAnswer } from '@clutch/shared';
import type { LastStandOpponent } from './bots';

export interface LastStandRunRow {
  id: string;
  player_id: string;
  display_name: string;
  date_key: string;
  status: 'in_progress' | 'eliminated' | 'cleared';
  survived: number;
  collisions: number;
  eliminated_by: 'timeout' | 'exhausted' | null;
  opponents_json: string;
  answers_json: string;
  counts_for_board: number;
  created_at: number;
  completed_at: number | null;
}

const runColumns = `id, player_id, display_name, date_key, status, survived, collisions,
  eliminated_by, opponents_json, answers_json, counts_for_board, created_at, completed_at`;

function validAnswer(value: unknown): value is RecordedAnswer {
  if (!value || typeof value !== 'object') return false;
  const { answer, atMs } = value as Record<string, unknown>;
  return typeof answer === 'string' && typeof atMs === 'number' && Number.isFinite(atMs);
}

/** Parses a stored per-round answer list; null if it is not a well-formed array. */
export function parseAnswers(json: string): (RecordedAnswer | null)[] | null {
  try {
    const value = JSON.parse(json) as unknown;
    if (!Array.isArray(value) || value.length > LAST_STAND_MAX_ROUNDS) return null;
    if (!value.every((item) => item === null || validAnswer(item))) return null;
    return value as (RecordedAnswer | null)[];
  } catch {
    return null;
  }
}

export function parseOpponents(json: string): LastStandOpponent[] | null {
  try {
    const value = JSON.parse(json) as unknown;
    if (!Array.isArray(value)) return null;
    const result: LastStandOpponent[] = [];
    for (const item of value) {
      if (!item || typeof item !== 'object') return null;
      const { runId, displayName, source, answers } = item as Record<string, unknown>;
      if (typeof runId !== 'string' || typeof displayName !== 'string'
        || (source !== 'player' && source !== 'bot') || !Array.isArray(answers)
        || !answers.every((answer) => answer === null || validAnswer(answer))) return null;
      result.push({ runId, displayName, source, answers: answers as (RecordedAnswer | null)[] });
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * Fresh ranked records of the day by other players that this player has not faced in any run.
 * Answers are padded to LAST_STAND_MAX_ROUNDS with nulls.
 */
export async function findPoolOpponents(
  db: D1Database,
  dateKey: string,
  playerId: string,
  limit: number,
): Promise<LastStandOpponent[]> {
  const result = await db.prepare(`
    SELECT id, display_name, answers_json
    FROM last_stand_runs
    WHERE date_key = ?1
      AND counts_for_board = 1
      AND status IN ('eliminated', 'cleared')
      AND player_id <> ?2
      AND id NOT IN (
        SELECT json_extract(opponent.value, '$.runId')
        FROM last_stand_runs AS mine, json_each(mine.opponents_json) AS opponent
        WHERE mine.player_id = ?2 AND mine.date_key = ?1
          AND json_valid(mine.opponents_json)
      )
    ORDER BY completed_at DESC, id ASC
    LIMIT 20
  `).bind(dateKey, playerId).all<{ id: string; display_name: string; answers_json: string }>();
  const opponents: LastStandOpponent[] = [];
  for (const row of result.results) {
    const answers = parseAnswers(row.answers_json);
    if (!answers) continue;
    while (answers.length < LAST_STAND_MAX_ROUNDS) answers.push(null);
    opponents.push({ runId: row.id, displayName: row.display_name, source: 'player', answers });
    if (opponents.length >= limit) break;
  }
  return opponents;
}

export async function createRun(db: D1Database, run: {
  id: string;
  playerId: string;
  displayName: string;
  dateKey: string;
  opponents: LastStandOpponent[];
  createdAt: number;
}): Promise<void> {
  await db.prepare(`
    INSERT INTO last_stand_runs (id, player_id, display_name, date_key, opponents_json, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
  `).bind(run.id, run.playerId, run.displayName, run.dateKey, JSON.stringify(run.opponents), run.createdAt).run();
}

export async function findRun(db: D1Database, id: string): Promise<LastStandRunRow | null> {
  return db.prepare(`SELECT ${runColumns} FROM last_stand_runs WHERE id = ?1`).bind(id).first<LastStandRunRow>();
}

/** Guarded by the state the caller read; false means another request moved the run first. */
export async function saveCollision(
  db: D1Database,
  run: LastStandRunRow,
  collisions: number,
): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE last_stand_runs SET collisions = ?1
    WHERE id = ?2 AND status = 'in_progress' AND survived = ?3 AND collisions = ?4
  `).bind(collisions, run.id, run.survived, run.collisions).run();
  return (result.meta.changes ?? 0) === 1;
}

/** The first run of the player's day to finish gets counts_for_board = 1, atomically. */
export async function saveAccepted(
  db: D1Database,
  run: LastStandRunRow,
  answers: (RecordedAnswer | null)[],
  cleared: boolean,
  now: number,
): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE last_stand_runs
    SET survived = survived + 1, collisions = 0, answers_json = ?1,
        status = ?2,
        completed_at = ?3,
        counts_for_board = CASE WHEN ?5 = 1 AND NOT EXISTS (
          SELECT 1 FROM last_stand_runs AS other
          WHERE other.player_id = ?6 AND other.date_key = ?7 AND other.counts_for_board = 1
        ) THEN 1 ELSE 0 END
    WHERE id = ?4 AND status = 'in_progress' AND survived = ?8 AND collisions = ?9
  `).bind(
    JSON.stringify(answers),
    cleared ? 'cleared' : 'in_progress',
    cleared ? now : null,
    run.id,
    cleared ? 1 : 0,
    run.player_id,
    run.date_key,
    run.survived,
    run.collisions,
  ).run();
  return (result.meta.changes ?? 0) === 1;
}

export async function saveEliminated(
  db: D1Database,
  run: LastStandRunRow,
  reason: 'timeout' | 'exhausted',
  now: number,
): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE last_stand_runs
    SET status = 'eliminated', eliminated_by = ?1, completed_at = ?2,
        counts_for_board = CASE WHEN NOT EXISTS (
          SELECT 1 FROM last_stand_runs AS other
          WHERE other.player_id = ?4 AND other.date_key = ?5 AND other.counts_for_board = 1
        ) THEN 1 ELSE 0 END
    WHERE id = ?3 AND status = 'in_progress' AND survived = ?6 AND collisions = ?7
  `).bind(reason, now, run.id, run.player_id, run.date_key, run.survived, run.collisions).run();
  return (result.meta.changes ?? 0) === 1;
}

export interface LeaderboardEntry {
  displayName: string;
  survived: number;
  completedAt: number;
}

export async function leaderboard(db: D1Database, dateKey: string): Promise<LeaderboardEntry[]> {
  const result = await db.prepare(`
    SELECT display_name AS displayName, survived, completed_at AS completedAt
    FROM last_stand_runs
    WHERE date_key = ?1 AND counts_for_board = 1 AND status IN ('eliminated', 'cleared')
    ORDER BY survived DESC, completed_at ASC, id ASC
    LIMIT 50
  `).bind(dateKey).all<LeaderboardEntry>();
  return result.results;
}
