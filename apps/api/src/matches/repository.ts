import { CURRENT_ASYNC_MATCH_CONDITIONS, MIN_POOL_ROUNDS, type Opponent, type Question } from '@clutch/shared';
import type { RunRow } from './types';
import { candidateSnapshot } from './validation';

export const currentMiniGameConfigJson = JSON.stringify(
  CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.config,
);

const runColumns = `
  id, player_id, display_name, questions_json, rounds_json, progress, correct_count, status,
  rules_version, mini_game_id, mini_game_config_json, opponent_json, ghost_eligible, opponent_run_id,
  created_at, pace_released`;

/** Какой пул соперников: версия правил и (для соло) только забеги, дошедшие до цели. */
export interface PoolOptions {
  rulesVersion?: string;
  reachedTargetOnly?: boolean;
  /** Момент подбора (мс): по нему решается, жив ли резерв под приглашение. По умолчанию — сейчас. */
  now?: number;
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
 * A run held by a live open friend invite (not consumed, not released, not expired) is not offered:
 * it is reserved for the link. The check uses expires_at, so it does not wait for the cron pass.
 */
/**
 * Сколько запись ждёт молчащего претендента.
 *
 * Считается не от захвата, а от последнего круга: пока человек отвечает, запись за ним, сколько бы
 * он ни играл (двадцать вопросов по пятнадцать секунд — это минуты). Замолчал — отпускаем, иначе
 * у владельца записи «Ждём соперника» висит из-за того, что кто-то закрыл приложение.
 */
export const CLAIM_IDLE_MS = 3 * 60 * 1000;

/**
 * Последняя активность претендента: время его последнего круга, а если кругов нет — время захвата.
 * Завершённый забег сюда не попадает: матч состоялся, и запись занята навсегда.
 */
const claimIdleSince = `
  COALESCE(
    (SELECT MAX(COALESCE(round.settled_at, round.created_at))
       FROM solo_run_rounds round WHERE round.run_id = match_runs.claimed_by),
    match_runs.claimed_at
  )`;

/** Запись свободна: её никто не держит либо держащий замолчал и ещё не доиграл. */
export const unclaimedCondition = (idleParam: number): string => `(
    match_runs.claimed_by IS NULL
    OR (
      ${claimIdleSince} <= ?${idleParam}
      AND EXISTS (
        SELECT 1 FROM match_runs challenger
        WHERE challenger.id = match_runs.claimed_by AND challenger.status = 'in_progress'
      )
    )
  )`;

/**
 * Забрать запись себе. Атомарно: в D1 нет ни блокировок строк, ни SKIP LOCKED, поэтому ровно
 * один одновременный запрос меняет строку, а остальные получают ноль изменений и идут дальше.
 *
 * Перехват у замолчавшего рвёт его пару: иначе он вернулся бы и доиграл против записи, которую
 * уже играет другой, и исход снова достался бы тому, кто случайно финишировал первым.
 */
export async function claimRecord(
  db: D1Database,
  recordRunId: string,
  challengerRunId: string,
  now: number,
): Promise<boolean> {
  const previous = await db.prepare('SELECT claimed_by FROM match_runs WHERE id = ?1')
    .bind(recordRunId)
    .first<{ claimed_by: string | null }>();
  const update = await db.prepare(`
    UPDATE match_runs
    SET claimed_by = ?2, claimed_at = ?3
    WHERE id = ?1 AND ${unclaimedCondition(4)}
  `).bind(recordRunId, challengerRunId, now, now - CLAIM_IDLE_MS).run();
  if (update.meta.changes === 0) return false;
  if (previous?.claimed_by && previous.claimed_by !== challengerRunId) {
    await dropPace(db, previous.claimed_by);
  }
  return true;
}

/**
 * Снять с забега соперника: пара разорвана, забег продолжается как одиночный и может сам стать
 * ждущей записью. `pace_released` нужен, чтобы вернувшемуся можно было об этом сказать.
 */
export async function dropPace(db: D1Database, runId: string): Promise<void> {
  await db.prepare(`
    UPDATE match_runs
    SET opponent_run_id = NULL, opponent_json = NULL, pace_released = 1
    WHERE id = ?1 AND status = 'in_progress'
  `).bind(runId).run();
}

/** Отпустить записи, чьи претенденты замолчали. Возвращает число освобождённых. */
export async function releaseExpiredClaims(db: D1Database, now: number, limit: number): Promise<number> {
  const stale = await db.prepare(`
    SELECT id, claimed_by FROM match_runs
    WHERE claimed_by IS NOT NULL AND ${unclaimedCondition(1)}
    LIMIT ?2
  `).bind(now - CLAIM_IDLE_MS, limit).all<{ id: string; claimed_by: string }>();
  for (const row of stale.results) {
    await db.prepare('UPDATE match_runs SET claimed_by = NULL, claimed_at = NULL WHERE id = ?1')
      .bind(row.id).run();
    await dropPace(db, row.claimed_by);
  }
  return stale.results.length;
}

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
  const setPlaceholders = questionSetIds.map((_, index) => `?${index + 7}`).join(', ');
  const claimPlaceholder = questionSetIds.length + 7;
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
      AND NOT EXISTS (
        SELECT 1 FROM rematch_invites reserved
        WHERE reserved.challenger_run_id = match_runs.id AND reserved.recipient_run_id IS NULL
          AND reserved.consumed_at IS NULL AND reserved.released_at IS NULL AND reserved.expires_at > ?6
      )
      -- Матч — это пара: запись достаётся одному сопернику, а забег, который сам играл против
      -- чьей-то записи, второй раз в пул не возвращается.
      AND opponent_run_id IS NULL
      AND ${unclaimedCondition(claimPlaceholder)}
    ORDER BY completed_at DESC LIMIT 20
  `).bind(
    MIN_POOL_ROUNDS,
    playerId,
    options.rulesVersion ?? CURRENT_ASYNC_MATCH_CONDITIONS.rulesVersion,
    CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.id,
    currentMiniGameConfigJson,
    options.now ?? Date.now(),
    ...questionSetIds,
    (options.now ?? Date.now()) - CLAIM_IDLE_MS,
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

export async function findRun(db: D1Database, matchId: string): Promise<RunRow | null> {
  return db.prepare(`SELECT ${runColumns} FROM match_runs WHERE id = ?1`)
    .bind(matchId)
    .first<RunRow>();
}

/**
 * Запись, ради которой созвано открытое приглашение: завершённый соло-забег, дошедший до цели, с
 * текущим конфигом молотка и пригодным для темпа снимком. Резерв здесь не проверяется: запись
 * забирает сам владелец ссылки, а не общий подбор. null — запись больше не годится.
 */
export async function findRecordRun(
  db: D1Database,
  runId: string,
  rulesVersion: string,
): Promise<GhostMatch | null> {
  const row = await db.prepare(`
    SELECT ${runColumns}, question_set_id
    FROM match_runs
    WHERE id = ?1 AND status = 'completed' AND reached_target = 1
      AND rules_version = ?2 AND mini_game_id = ?3 AND mini_game_config_json = ?4
  `).bind(
    runId,
    rulesVersion,
    CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.id,
    currentMiniGameConfigJson,
  ).first<RunRow>();
  if (!row?.question_set_id) return null;
  const snapshot = candidateSnapshot(row);
  return snapshot ? { row, questionSetId: row.question_set_id, ...snapshot } : null;
}
