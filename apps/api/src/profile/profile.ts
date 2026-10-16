import type { Hono } from 'hono';
import { resolveRequestIdentity } from '../auth/identity';
import type { Env } from '../env';
import { checkRateLimit, RATE_LIMIT_PERIOD_SECONDS } from '../http/rateLimit';
import { getSoloProfile } from './profileRepository';

export function registerProfileRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/api/profile', async (c) => {
    const identity = await resolveRequestIdentity(c.req.header('Authorization'), c.env);
    if (!identity) return c.json({ error: 'Authentication required.' }, 401);

    const rateLimit = await checkRateLimit(c.env.API_RATE_LIMITER, `profile:${identity.playerId}`);
    if (rateLimit === 'limited') {
      c.header('Retry-After', String(RATE_LIMIT_PERIOD_SECONDS));
      return c.json({ error: 'Too many requests.' }, 429);
    }
    if (rateLimit === 'unavailable') return c.json({ error: 'Rate limiter unavailable.' }, 503);

    return c.json(await getSoloProfile(c.env.DB, identity.playerId));
  });
}
