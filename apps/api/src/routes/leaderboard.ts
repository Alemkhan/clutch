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
      WITH ranked_runs AS (
        SELECT id, player_id, display_name, progress, correct_count, completed_at,
               ROW_NUMBER() OVER (
                 PARTITION BY player_id
                 ORDER BY progress DESC,
                          correct_count DESC,
                          CASE WHEN completed_at IS NULL THEN 1 ELSE 0 END ASC,
                          completed_at ASC,
                          id ASC
               ) AS player_rank
        FROM match_runs
        WHERE category = ?1 AND status = 'completed'
          AND (rules_version IS NULL OR rules_version NOT LIKE 'solo-%')
      )
      SELECT display_name AS displayName, progress,
             correct_count AS correctCount, completed_at AS completedAt
      FROM ranked_runs
      WHERE player_rank = 1
      ORDER BY progress DESC,
               correctCount DESC,
               CASE WHEN completedAt IS NULL THEN 1 ELSE 0 END ASC,
               completedAt ASC,
               id ASC
      LIMIT 50
    `).bind(category).all();
    return c.json({ category, entries: result.results });
  });
}
