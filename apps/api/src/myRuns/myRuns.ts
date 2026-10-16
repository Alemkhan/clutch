import type { MyRunsResponse } from '@clutch/shared';
import type { Hono } from 'hono';
import { resolveRequestIdentity } from '../auth/identity';
import type { Env } from '../env';
import { checkRateLimit, RATE_LIMIT_PERIOD_SECONDS } from '../http/rateLimit';
import {
  encodeHistoryCursor,
  listCompletedRuns,
  parseHistoryCursor,
  toRunSummary,
} from './historyRepository';
import { listActiveInvitesForRecipient } from '../notifications/repository';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_INVITES = 20;

export function registerMyRunsRoutes(app: Hono<{ Bindings: Env }>): void {
  // Партии игрока и активные вызовы на реванш: у браузерных гостей нет chat_id,
  // и здесь они единственный раз узнают о вызове.
  app.get('/api/my-runs', async (c) => {
    const identity = await resolveRequestIdentity(c.req.header('Authorization'), c.env);
    if (!identity) return c.json({ error: 'Authentication required.' }, 401);
    const rateLimit = await checkRateLimit(c.env.API_RATE_LIMITER, `my-runs:${identity.playerId}`);
    if (rateLimit === 'limited') {
      c.header('Retry-After', String(RATE_LIMIT_PERIOD_SECONDS));
      return c.json({ error: 'Too many requests.' }, 429);
    }
    if (rateLimit === 'unavailable') return c.json({ error: 'Rate limiter unavailable.' }, 503);

    const limitParam = c.req.query('limit');
    const limit = limitParam === undefined ? DEFAULT_LIMIT : Number(limitParam);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return c.json({ error: 'Invalid limit.' }, 400);
    }
    const before = c.req.query('before');
    const cursor = before === undefined ? null : parseHistoryCursor(before);
    if (before !== undefined && !cursor) return c.json({ error: 'Invalid cursor.' }, 400);

    const rows = await listCompletedRuns(c.env.DB, identity.playerId, limit, cursor);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    // Приглашения не листаются: их мало, и нужны они только на первой странице.
    const invites = cursor ? [] : await listActiveInvitesForRecipient(
      c.env.DB,
      identity.playerId,
      Date.now(),
      MAX_INVITES,
    );
    const response: MyRunsResponse = {
      runs: page.map((row) => toRunSummary(row, identity.playerId)),
      nextCursor: rows.length > limit && last
        ? encodeHistoryCursor({ completedAt: last.completed_at, id: last.id })
        : null,
      invites: invites.map((invite) => ({
        inviteId: invite.id,
        category: invite.category as MyRunsResponse['invites'][number]['category'],
        challengerName: invite.challenger_name,
        challengerProgress: invite.challenger_progress,
        yourProgress: invite.recipient_progress,
        challengerRoundsPlayed: invite.challenger_rounds ?? null,
        recipientRoundsPlayed: invite.recipient_rounds ?? null,
        expiresAt: invite.expires_at,
      })),
    };
    return c.json(response);
  });
}
