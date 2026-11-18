import type { Hono } from 'hono';
import { resolveRequestIdentity } from '../auth/identity';
import type { Env } from '../env';
import { readJsonBody } from '../http/jsonBody';
import { checkRateLimit, RATE_LIMIT_PERIOD_SECONDS } from '../http/rateLimit';
import { clanDeletionStatements } from '../clans/clans';

/**
 * Удаление аккаунта (требование App Store 5.1.1(v) и Google Play).
 *
 * Личное удаляется целиком: ошибки, настройки уведомлений, жалобы, аналитика, ответы «На глазок»,
 * вики-забеги, отметки рассылок. Забеги, на которые опираются чужие дуэли, реванши, групповые
 * вызовы и «Последний герой», не стираются — иначе у соперников пропали бы их результаты. Они
 * обезличиваются: player_id меняется на случайный `deleted:<uuid>`, имя — на «Удалённый игрок»,
 * в том числе в снимках соперника внутри чужих записей. Связать их с человеком больше нельзя.
 */
export const DELETED_PLAYER_NAME = 'Удалённый игрок';
export const DELETED_PLAYER_PREFIX = 'deleted:';

const DELETED_TABLES = [
  'player_mistakes',
  'player_settings',
  'player_notification_prefs',
  'question_reports',
  'analytics_events',
  'tiebreaker_answers',
  'top_ten_notices',
  'daily_notification_deliveries',
  'announcement_deliveries',
  'wiki_path_runs',
] as const;

export interface DeletedAccountSummary {
  deletedRows: number;
  anonymizedRuns: number;
}

/** Чужие записи «Последнего героя», где игрок был соперником: имя в снимке заменяется. */
async function anonymizeLastStandSnapshots(db: D1Database, playerId: string): Promise<D1PreparedStatement[]> {
  const mine = await db.prepare('SELECT id FROM last_stand_runs WHERE player_id = ?1').bind(playerId).all<{ id: string }>();
  const ids = new Set((mine.results ?? []).map((row) => row.id));
  if (!ids.size) return [];
  const rows = await db.prepare(`SELECT DISTINCT r.id, r.opponents_json FROM last_stand_runs r, json_each(r.opponents_json) o
    WHERE json_valid(r.opponents_json) AND json_extract(o.value, '$.runId') IN (SELECT id FROM last_stand_runs WHERE player_id = ?1)`)
    .bind(playerId).all<{ id: string; opponents_json: string }>();
  return (rows.results ?? []).map((row) => {
    const opponents = (JSON.parse(row.opponents_json) as Array<Record<string, unknown>>)
      .map((item) => (ids.has(String(item.runId)) ? { ...item, displayName: DELETED_PLAYER_NAME } : item));
    return db.prepare('UPDATE last_stand_runs SET opponents_json = ?2 WHERE id = ?1').bind(row.id, JSON.stringify(opponents));
  });
}

export async function deletePlayerAccount(db: D1Database, playerId: string): Promise<DeletedAccountSummary> {
  const tombstone = `${DELETED_PLAYER_PREFIX}${crypto.randomUUID()}`;
  const snapshots = await anonymizeLastStandSnapshots(db, playerId);
  const deletes = DELETED_TABLES.map((table) => db.prepare(`DELETE FROM ${table} WHERE player_id = ?1`).bind(playerId));
  const anonymize = [
    // Снимки соперника в чужих забегах — до смены player_id, пока свои забеги ещё находятся.
    db.prepare(`UPDATE match_runs SET opponent_json = json_set(opponent_json, '$.displayName', ?2)
      WHERE json_valid(opponent_json) AND opponent_run_id IN (SELECT id FROM match_runs WHERE player_id = ?1)`)
      .bind(playerId, DELETED_PLAYER_NAME),
    db.prepare('UPDATE match_runs SET player_id = ?2, display_name = ?3 WHERE player_id = ?1')
      .bind(playerId, tombstone, DELETED_PLAYER_NAME),
    db.prepare('UPDATE last_stand_runs SET player_id = ?2, display_name = ?3 WHERE player_id = ?1')
      .bind(playerId, tombstone, DELETED_PLAYER_NAME),
    db.prepare('UPDATE group_challenge_entries SET player_id = ?2 WHERE player_id = ?1').bind(playerId, tombstone),
    db.prepare('UPDATE group_challenges SET creator_player_id = ?2 WHERE creator_player_id = ?1').bind(playerId, tombstone),
    db.prepare('UPDATE rematch_invites SET recipient_player_id = ?2 WHERE recipient_player_id = ?1').bind(playerId, tombstone),
  ];
  // batch в D1 — одна транзакция: либо всё, либо ничего.
  // Клан — последним: смещения выше считают удалённые и обезличенные строки.
  const results = await db.batch([...snapshots, ...deletes, ...anonymize, ...clanDeletionStatements(db, playerId, tombstone)]);
  const changes = (index: number) => Number(results[index]?.meta?.changes ?? 0);
  const offset = snapshots.length;
  return {
    deletedRows: deletes.reduce((sum, _statement, index) => sum + changes(offset + index), 0),
    anonymizedRuns: changes(offset + deletes.length + 1) + changes(offset + deletes.length + 2),
  };
}

export function registerAccountRoutes(app: Hono<{ Bindings: Env }>): void {
  app.delete('/api/account', async (c) => {
    c.header('Cache-Control', 'no-store');
    const identity = await resolveRequestIdentity(c.req.header('Authorization'), c.env);
    if (!identity) return c.json({ error: 'Authentication required.' }, 401);
    const limited = await checkRateLimit(c.env.API_RATE_LIMITER, `account-delete:${identity.playerId}`);
    if (limited === 'limited') {
      c.header('Retry-After', String(RATE_LIMIT_PERIOD_SECONDS));
      return c.json({ error: 'Too many requests.' }, 429);
    }
    if (limited === 'unavailable') return c.json({ error: 'Rate limiter unavailable.' }, 503);
    // Явное подтверждение в теле: случайный DELETE без него ничего не стирает.
    const parsed = await readJsonBody(c.req.raw, 256);
    if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
    if ((parsed.value as { confirm?: unknown } | null)?.confirm !== 'delete') {
      return c.json({ error: 'Confirmation required.' }, 400);
    }
    const summary = await deletePlayerAccount(c.env.DB, identity.playerId);
    console.log({ event: 'account_deleted', kind: identity.kind, ...summary });
    return c.json({ deleted: true });
  });
}
