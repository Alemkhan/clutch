import type { Context, Hono } from 'hono';
import { resolveRequestIdentity, type RequestIdentity } from '../auth/identity';
import type { Env } from '../env';
import { readJsonBody } from '../http/jsonBody';
import { checkRateLimit, RATE_LIMIT_PERIOD_SECONDS } from '../http/rateLimit';
import { REMATCH_INVITE_ID } from '../matches/validation';
import { findInvite, inviteMode, isOutbidEnabled, setOutbidEnabled } from '../notifications/repository';

type AppContext = Context<{ Bindings: Env }>;

async function authenticate(c: AppContext, scope: string): Promise<RequestIdentity | Response> {
  const identity = await resolveRequestIdentity(c.req.header('Authorization'), c.env);
  if (!identity) return c.json({ error: 'Authentication required.' }, 401);
  const rateLimit = await checkRateLimit(c.env.API_RATE_LIMITER, `${scope}:${identity.playerId}`);
  if (rateLimit === 'limited') {
    c.header('Retry-After', String(RATE_LIMIT_PERIOD_SECONDS));
    return c.json({ error: 'Too many requests.' }, 429);
  }
  if (rateLimit === 'unavailable') return c.json({ error: 'Rate limiter unavailable.' }, 503);
  return identity;
}

export function registerRematchRoutes(app: Hono<{ Bindings: Env }>): void {
  // Preview for the "rematch with ..." screen. An invite that is not addressed to the caller is
  // indistinguishable from a missing one.
  app.get('/api/rematch/:id', async (c) => {
    const identity = await authenticate(c, 'rematch');
    if (identity instanceof Response) return identity;
    const id = c.req.param('id');
    if (!REMATCH_INVITE_ID.test(id)) return c.json({ error: 'Rematch invite not found.' }, 404);
    const invite = await findInvite(c.env.DB, id);
    if (!invite || invite.recipient_player_id !== identity.playerId) {
      return c.json({ error: 'Rematch invite not found.' }, 404);
    }
    if (invite.consumed_at !== null || invite.expires_at <= Date.now()) {
      return c.json({ error: 'Rematch invite is no longer available.' }, 410);
    }
    const challenger = await c.env.DB.prepare('SELECT display_name FROM match_runs WHERE id = ?1')
      .bind(invite.challenger_run_id)
      .first<{ display_name: string }>();
    if (!challenger) return c.json({ error: 'Rematch invite is no longer available.' }, 410);
    return c.json({
      inviteId: invite.id,
      category: invite.category,
      /** Куда вести игрока: гоночный или соло-старт. */
      mode: inviteMode(invite),
      challengerName: challenger.display_name,
      challengerProgress: invite.challenger_progress,
      yourProgress: invite.recipient_progress,
      expiresAt: invite.expires_at,
    });
  });

  app.get('/api/notifications/outbid', async (c) => {
    const identity = await authenticate(c, 'notifications');
    if (identity instanceof Response) return identity;
    return c.json({ enabled: await isOutbidEnabled(c.env.DB, identity.playerId) });
  });

  app.put('/api/notifications/outbid', async (c) => {
    const identity = await authenticate(c, 'notifications');
    if (identity instanceof Response) return identity;
    const parsed = await readJsonBody(c.req.raw, 256);
    if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
    const body = parsed.value as { enabled?: unknown } | null;
    if (!body || typeof body.enabled !== 'boolean') return c.json({ error: 'Invalid enabled flag.' }, 400);
    await setOutbidEnabled(c.env.DB, identity.playerId, body.enabled);
    return c.json({ enabled: body.enabled });
  });
}
