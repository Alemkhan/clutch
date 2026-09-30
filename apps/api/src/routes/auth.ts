import type { GuestSessionResponse } from '@clutch/shared';
import type { Hono } from 'hono';
import { hasValidSessionSecret, issueGuestSession, verifyGuestToken } from '../auth/guest';
import type { Env } from '../env';
import {
  checkRateLimit,
  clientRateLimitKey,
  RATE_LIMIT_PERIOD_SECONDS,
} from '../http/rateLimit';

export function registerAuthRoutes(app: Hono<{ Bindings: Env }>): void {
  app.post('/api/auth/guest', async (c) => {
    c.header('Cache-Control', 'no-store');
    const rateLimit = await checkRateLimit(
      c.env.API_RATE_LIMITER,
      `guest:${clientRateLimitKey(c.req.raw)}`,
    );
    if (rateLimit === 'limited') {
      c.header('Retry-After', String(RATE_LIMIT_PERIOD_SECONDS));
      return c.json({ error: 'Too many requests.' }, 429);
    }
    if (rateLimit === 'unavailable') {
      return c.json({ error: 'Rate limiter unavailable.' }, 503);
    }
    if (!hasValidSessionSecret(c.env.SESSION_SIGNING_SECRET)) {
      return c.json({ error: 'Guest sessions are unavailable.' }, 503);
    }
    const authorization = c.req.header('Authorization');
    let subject: string | undefined;
    if (authorization) {
      const bearer = /^bearer ([^\s]+)$/iu.exec(authorization);
      if (!bearer) return c.json({ error: 'Invalid guest session.' }, 401);
      const current = await verifyGuestToken(bearer[1], c.env.SESSION_SIGNING_SECRET);
      if (!current) return c.json({ error: 'Invalid guest session.' }, 401);
      subject = current.playerId.slice('guest:'.length);
    }
    const session = await issueGuestSession(c.env.SESSION_SIGNING_SECRET, Date.now(), subject);
    if (!session) return c.json({ error: 'Guest sessions are unavailable.' }, 503);
    const response: GuestSessionResponse = { token: session.token, expiresAt: session.expiresAt };
    return c.json(response, 201);
  });
}
