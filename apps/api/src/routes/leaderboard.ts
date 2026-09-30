import type { Hono } from 'hono';
import type { Env } from '../env';
import {
  checkRateLimit,
  clientRateLimitKey,
  RATE_LIMIT_PERIOD_SECONDS,
} from '../http/rateLimit';
import { categories } from '../matches/validation';

export function registerLeaderboardRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/api/leaderboard', async (c) => {
    const rateLimit = await checkRateLimit(
      c.env.API_RATE_LIMITER,
      `leaderboard:${clientRateLimitKey(c.req.raw)}`,
    );
    if (rateLimit === 'limited') {
      c.header('Retry-After', String(RATE_LIMIT_PERIOD_SECONDS));
      return c.json({ error: 'Too many requests.' }, 429);
    }
    if (rateLimit === 'unavailable') return c.json({ error: 'Rate limiter unavailable.' }, 503);
    const category = c.req.query('category') ?? 'geography';
    if (!categories.has(category)) return c.json({ error: 'Invalid category.' }, 400);
    const result = await c.env.DB.prepare(`
      SELECT display_name AS displayName, MAX(progress) AS progress,
             MAX(correct_count) AS correctCount, MAX(completed_at) AS completedAt
      FROM match_runs
      WHERE category = ?1 AND status = 'completed'
      GROUP BY player_id, display_name
      ORDER BY progress DESC, correctCount DESC, completedAt ASC
      LIMIT 50
    `).bind(category).all();
    return c.json({ category, entries: result.results });
  });
}
