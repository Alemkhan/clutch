import { dailyKey } from '@clutch/shared';
import type { Context, Hono } from 'hono';
import { resolveRequestIdentity, type RequestIdentity } from '../auth/identity';
import type { Env } from '../env';
import { readJsonBody } from '../http/jsonBody';
import { checkRateLimit, RATE_LIMIT_PERIOD_SECONDS } from '../http/rateLimit';
import { findQuestionByDate } from '../tiebreaker/tiebreakerRepository';
import { findChallenge } from '../wikiPath/wikiPathRepository';
import { miniAppLink, telegramChatId } from './outbid';
import { sendTelegramMessage, type SendResult } from './telegram';

type AppContext = Context<{ Bindings: Env }>;
const ACTIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const DELIVERY_BATCH_SIZE = 20;
/** 17:00 в Алматы (UTC+5). Последующие cron-проходы добирают очередь небольшими пачками. */
const SEND_AFTER_UTC_HOUR = 12;

export const DAILY_TIEBREAKER_PAYLOAD = 'daily_guess';
export const DAILY_WIKI_PATH_PAYLOAD = 'daily_wiki';
export const DAILY_STOP_PAYLOAD = 'daily_off';

async function authenticate(c: AppContext): Promise<RequestIdentity | Response> {
  const identity = await resolveRequestIdentity(c.req.header('Authorization'), c.env);
  if (!identity) return c.json({ error: 'Authentication required.' }, 401);
  const limited = await checkRateLimit(c.env.API_RATE_LIMITER, `daily-notifications:${identity.playerId}`);
  if (limited === 'limited') {
    c.header('Retry-After', String(RATE_LIMIT_PERIOD_SECONDS));
    return c.json({ error: 'Too many requests.' }, 429);
  }
  if (limited === 'unavailable') return c.json({ error: 'Rate limiter unavailable.' }, 503);
  if (identity.kind !== 'telegram') return c.json({ error: 'Telegram account required.', reason: 'telegram_required' }, 403);
  return identity;
}

export async function isDailyDigestEnabled(db: D1Database, playerId: string): Promise<boolean> {
  const row = await db.prepare('SELECT daily_enabled FROM player_notification_prefs WHERE player_id = ?1')
    .bind(playerId).first<{ daily_enabled: number }>();
  return row?.daily_enabled === 1;
}

export async function setDailyDigestEnabled(db: D1Database, playerId: string, enabled: boolean, now = Date.now()): Promise<void> {
  await db.prepare(`INSERT INTO player_notification_prefs (player_id, outbid_enabled, daily_enabled, updated_at)
    VALUES (?1, 1, ?2, ?3)
    ON CONFLICT(player_id) DO UPDATE SET daily_enabled = excluded.daily_enabled, updated_at = excluded.updated_at`)
    .bind(playerId, enabled ? 1 : 0, now).run();
}

export function registerDailyNotificationRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/api/notifications/daily', async (c) => {
    const identity = await authenticate(c);
    if (identity instanceof Response) return identity;
    return c.json({ enabled: await isDailyDigestEnabled(c.env.DB, identity.playerId) });
  });

  app.put('/api/notifications/daily', async (c) => {
    const identity = await authenticate(c);
    if (identity instanceof Response) return identity;
    const parsed = await readJsonBody(c.req.raw, 256);
    if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
    const body = parsed.value as { enabled?: unknown } | null;
    if (!body || typeof body.enabled !== 'boolean') return c.json({ error: 'Invalid enabled flag.' }, 400);
    await setDailyDigestEnabled(c.env.DB, identity.playerId, body.enabled);
    return c.json({ enabled: body.enabled });
  });
}

interface DigestRecipient { player_id: string }

async function listRecipients(db: D1Database, dateKey: string, now: number): Promise<DigestRecipient[]> {
  const cutoff = now - ACTIVE_WINDOW_MS;
  const result = await db.prepare(`SELECT p.player_id FROM player_notification_prefs p
    WHERE p.daily_enabled = 1 AND p.player_id LIKE 'telegram:%'
      AND (p.updated_at >= ?1
        OR EXISTS (SELECT 1 FROM match_runs m WHERE m.player_id = p.player_id AND m.created_at >= ?1)
        OR EXISTS (SELECT 1 FROM tiebreaker_answers a WHERE a.player_id = p.player_id AND a.created_at >= ?1)
        OR EXISTS (SELECT 1 FROM wiki_path_runs w WHERE w.player_id = p.player_id AND w.created_at >= ?1))
      AND NOT EXISTS (SELECT 1 FROM daily_notification_deliveries d
        WHERE d.player_id = p.player_id AND d.date_key = ?2)
    ORDER BY p.updated_at DESC, p.player_id ASC LIMIT ?3`)
    .bind(cutoff, dateKey, DELIVERY_BATCH_SIZE).all<DigestRecipient>();
  return result.results ?? [];
}

async function claimDelivery(db: D1Database, playerId: string, dateKey: string, now: number): Promise<boolean> {
  const result = await db.prepare(`INSERT OR IGNORE INTO daily_notification_deliveries
    (player_id, date_key, status, created_at, updated_at) VALUES (?1, ?2, 'claimed', ?3, ?3)`)
    .bind(playerId, dateKey, now).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

async function markDelivery(db: D1Database, playerId: string, dateKey: string, result: SendResult, now: number): Promise<void> {
  await db.prepare(`UPDATE daily_notification_deliveries SET status = ?3, updated_at = ?4
    WHERE player_id = ?1 AND date_key = ?2`)
    .bind(playerId, dateKey, result.status, now).run();
  if (result.status === 'blocked') await setDailyDigestEnabled(db, playerId, false, now);
}

export interface DailyDigestSummary {
  dateKey: string;
  candidates: number;
  sent: number;
  blocked: number;
  failed: number;
  skipped: boolean;
}

/** Cron-safe: a unique delivery row is claimed before Telegram is called. */
export async function sendDailyChallengeDigests(env: Env, now = Date.now()): Promise<DailyDigestSummary> {
  const dateKey = dailyKey(now);
  const summary: DailyDigestSummary = { dateKey, candidates: 0, sent: 0, blocked: 0, failed: 0, skipped: false };
  if (new Date(now).getUTCHours() < SEND_AFTER_UTC_HOUR || !env.TELEGRAM_BOT_TOKEN) {
    summary.skipped = true;
    return summary;
  }
  const [question, challenge] = await Promise.all([
    findQuestionByDate(env.DB, dateKey),
    findChallenge(env.DB, dateKey),
  ]);
  if (!question && !challenge) {
    summary.skipped = true;
    return summary;
  }

  const recipients = await listRecipients(env.DB, dateKey, now);
  summary.candidates = recipients.length;
  await Promise.all(recipients.map(async ({ player_id: playerId }) => {
    if (!(await claimDelivery(env.DB, playerId, dateKey, now))) return;
    const chatId = telegramChatId(playerId);
    if (!chatId) return;
    const lines = ['Новый день в Clutch'];
    if (question) lines.push(`👁 «На глазок» #${question.number} уже вышел.`);
    if (challenge) lines.push(`🔗 Вики-путь: ${challenge.start_title} → ${challenge.target_title}.`);
    const gameButtons = [
      ...(question ? [{ text: 'На глазок', url: miniAppLink(env.TELEGRAM_MINI_APP_LINK, DAILY_TIEBREAKER_PAYLOAD) }] : []),
      ...(challenge ? [{ text: 'Вики-путь', url: miniAppLink(env.TELEGRAM_MINI_APP_LINK, DAILY_WIKI_PATH_PAYLOAD) }] : []),
    ].filter((button): button is { text: string; url: string } => Boolean(button.url));
    const stopUrl = miniAppLink(env.TELEGRAM_MINI_APP_LINK, DAILY_STOP_PAYLOAD);
    const buttons = [
      ...(gameButtons.length ? [gameButtons] : []),
      ...(stopUrl ? [[{ text: 'Отключить ежедневные сообщения', url: stopUrl }]] : []),
    ];
    const result = await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, lines.join('\n'), buttons);
    await markDelivery(env.DB, playerId, dateKey, result, now);
    summary[result.status] += 1;
    if (result.status !== 'sent') console.error({
      event: 'telegram_notification_delivery', kind: 'daily_digest', deliveryStatus: result.status,
      reasonCode: result.reasonCode, httpStatus: result.httpStatus,
    });
  }));
  return summary;
}
