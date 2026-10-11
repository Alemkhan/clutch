import { CURRENT_SOLO_RUN_CONDITIONS } from '@clutch/shared';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface InviteRow {
  id: string;
  /** Пусто у открытого приглашения («Позвать друга») до погашения: адресатом станет первый, кто начнёт забег. */
  recipient_player_id: string | null;
  recipient_run_id: string | null;
  challenger_run_id: string;
  category: string;
  recipient_progress: number;
  challenger_progress: number;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
  /** Версия правил забега-вызова; по ней определяется режим приглашения. */
  challenger_rules_version: string | null;
}

export type InviteMode = 'race' | 'solo';

/** Приглашение ведёт в тот режим, в котором сыгран забег-вызов; всё, что не соло, — гонка. */
export function inviteMode(invite: Pick<InviteRow, 'challenger_rules_version'>): InviteMode {
  return invite.challenger_rules_version === CURRENT_SOLO_RUN_CONDITIONS.rulesVersion ? 'solo' : 'race';
}

/** Открытое приглашение: адресата и его записи нет, пока ссылку не погасят. */
export function isOpenInvite(invite: Pick<InviteRow, 'recipient_run_id'>): boolean {
  return invite.recipient_run_id === null;
}

export type InviteUnavailableReason = 'taken' | 'expired';

/** Почему приглашение уже нельзя принять; null — можно. Погашенное важнее просроченного. */
export function inviteUnavailableReason(
  invite: Pick<InviteRow, 'consumed_at' | 'expires_at'>,
  now: number,
): InviteUnavailableReason | null {
  if (invite.consumed_at !== null) return 'taken';
  return invite.expires_at <= now ? 'expired' : null;
}

/** No row means enabled: the opt-out default is applied here and nowhere else. */
export async function isOutbidEnabled(db: D1Database, playerId: string): Promise<boolean> {
  const row = await db.prepare('SELECT outbid_enabled FROM player_notification_prefs WHERE player_id = ?1')
    .bind(playerId)
    .first<{ outbid_enabled: number }>();
  return row ? row.outbid_enabled === 1 : true;
}

export async function setOutbidEnabled(db: D1Database, playerId: string, enabled: boolean): Promise<void> {
  await db.prepare(`
    INSERT INTO player_notification_prefs (player_id, outbid_enabled, updated_at)
    VALUES (?1, ?2, ?3)
    ON CONFLICT(player_id) DO UPDATE SET outbid_enabled = excluded.outbid_enabled, updated_at = excluded.updated_at
  `).bind(playerId, enabled ? 1 : 0, Date.now()).run();
}

/** True when this exact (recipient run, challenger run) pair was recorded now; false when it already existed. */
export async function insertInviteOnce(db: D1Database, invite: {
  id: string;
  recipientPlayerId: string;
  recipientRunId: string;
  challengerRunId: string;
  category: string;
  recipientProgress: number;
  challengerProgress: number;
}): Promise<boolean> {
  const now = Date.now();
  const result = await db.prepare(`
    INSERT OR IGNORE INTO rematch_invites (
      id, recipient_player_id, recipient_run_id, challenger_run_id, category,
      recipient_progress, challenger_progress, created_at, expires_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
  `).bind(
    invite.id,
    invite.recipientPlayerId,
    invite.recipientRunId,
    invite.challengerRunId,
    invite.category,
    invite.recipientProgress,
    invite.challengerProgress,
    now,
    now + INVITE_TTL_MS,
  ).run();
  return result.meta.changes > 0;
}

/**
 * Открытое приглашение на запись автора: без адресата, со сроком и одноразовостью как у реванша.
 * false, если для этого забега открытое приглашение уже есть (уникальный индекс).
 */
export async function insertOpenInviteOnce(db: D1Database, invite: {
  id: string;
  challengerRunId: string;
  category: string;
  challengerProgress: number;
  now: number;
}): Promise<boolean> {
  const result = await db.prepare(`
    INSERT OR IGNORE INTO rematch_invites (
      id, recipient_player_id, recipient_run_id, challenger_run_id, category,
      recipient_progress, challenger_progress, created_at, expires_at, notify_status
    ) VALUES (?1, NULL, NULL, ?2, ?3, 0, ?4, ?5, ?6, 'sent')
  `).bind(
    invite.id,
    invite.challengerRunId,
    invite.category,
    invite.challengerProgress,
    invite.now,
    invite.now + INVITE_TTL_MS,
  ).run();
  return result.meta.changes > 0;
}

export async function findOpenInviteForRun(db: D1Database, challengerRunId: string): Promise<InviteRow | null> {
  return db.prepare(`
    SELECT i.id, i.recipient_player_id, i.recipient_run_id, i.challenger_run_id, i.category,
           i.recipient_progress, i.challenger_progress, i.created_at, i.expires_at, i.consumed_at,
           c.rules_version AS challenger_rules_version
    FROM rematch_invites i
    LEFT JOIN match_runs c ON c.id = i.challenger_run_id
    WHERE i.challenger_run_id = ?1 AND i.recipient_run_id IS NULL
  `).bind(challengerRunId).first<InviteRow>();
}

export async function markInviteNotified(db: D1Database, id: string, sent: boolean): Promise<void> {
  await db.prepare('UPDATE rematch_invites SET notify_status = ?2 WHERE id = ?1')
    .bind(id, sent ? 'sent' : 'failed')
    .run();
}

export async function findInvite(db: D1Database, id: string): Promise<InviteRow | null> {
  return db.prepare(`
    SELECT i.id, i.recipient_player_id, i.recipient_run_id, i.challenger_run_id, i.category,
           i.recipient_progress, i.challenger_progress, i.created_at, i.expires_at, i.consumed_at,
           c.rules_version AS challenger_rules_version
    FROM rematch_invites i
    LEFT JOIN match_runs c ON c.id = i.challenger_run_id
    WHERE i.id = ?1
  `).bind(id).first<InviteRow>();
}

/**
 * Atomically spends the invite for its addressee; false if spent, expired or addressed to someone else.
 * Открытое приглашение достаётся тому, чей UPDATE выполнился первым (меняется ровно одна строка), и
 * никогда автору записи. Адресатом становится погасивший.
 */
export async function consumeInvite(
  db: D1Database,
  id: string,
  playerId: string,
  rematchRunId: string,
): Promise<boolean> {
  const now = Date.now();
  const result = await db.prepare(`
    UPDATE rematch_invites SET consumed_at = ?3, rematch_run_id = ?4, recipient_player_id = ?2
    WHERE id = ?1 AND consumed_at IS NULL AND expires_at > ?3
      AND (
        recipient_player_id = ?2
        OR (
          recipient_player_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM match_runs c WHERE c.id = challenger_run_id AND c.player_id = ?2)
        )
      )
  `).bind(id, playerId, now, rematchRunId).run();
  return result.meta.changes > 0;
}

export async function releaseInvite(db: D1Database, id: string): Promise<void> {
  // У открытого приглашения возврат снимает и адресата: ссылка снова свободна для первого.
  await db.prepare(`
    UPDATE rematch_invites
    SET consumed_at = NULL, rematch_run_id = NULL,
        recipient_player_id = CASE WHEN recipient_run_id IS NULL THEN NULL ELSE recipient_player_id END
    WHERE id = ?1
  `).bind(id).run();
}

/**
 * Marks expired, unused, not yet released invites as released, at most `limit` per call, and
 * returns how many were marked. One statement, so a repeat call finds nothing left to do.
 */
export async function releaseExpiredInvites(db: D1Database, now: number, limit: number): Promise<number> {
  const result = await db.prepare(`
    UPDATE rematch_invites SET released_at = ?1
    WHERE id IN (
      SELECT id FROM rematch_invites
      WHERE expires_at <= ?1 AND consumed_at IS NULL AND released_at IS NULL
      ORDER BY expires_at LIMIT ?2
    )
  `).bind(now, limit).run();
  return result.meta.changes;
}

/** Активные приглашения адресата: не потрачены и не истекли на момент now. Новые сверху. */
export async function listActiveInvitesForRecipient(
  db: D1Database,
  playerId: string,
  now: number,
  limit: number,
): Promise<Array<Omit<InviteRow, 'challenger_rules_version'> & { challenger_name: string }>> {
  const result = await db.prepare(`
    SELECT i.id, i.recipient_player_id, i.recipient_run_id, i.challenger_run_id, i.category,
           i.recipient_progress, i.challenger_progress, i.created_at, i.expires_at, i.consumed_at,
           m.display_name AS challenger_name
    FROM rematch_invites i
    JOIN match_runs m ON m.id = i.challenger_run_id
    WHERE i.recipient_player_id = ?1 AND i.consumed_at IS NULL AND i.expires_at > ?2
    ORDER BY i.created_at DESC, i.id DESC
    LIMIT ?3
  `).bind(playerId, now, limit).all<Omit<InviteRow, 'challenger_rules_version'> & { challenger_name: string }>();
  return result.results;
}
