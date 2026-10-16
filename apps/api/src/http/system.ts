import type { Hono } from 'hono';
import type { Env } from '../env';

export function registerSystemRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/', (c) => c.json({
    name: 'Clutch API',
    status: 'ok',
    tagline: 'Knowledge earns the attempt. Skill wins the game.',
  }));

  app.get('/api/health', (c) => c.json({
    status: 'ok',
    timestamp: Date.now(),
    environment: c.env.ENVIRONMENT,
  }));

  app.get('/api/ready', async (c) => {
    try {
      const result = await c.env.DB.prepare(`
        SELECT
          id, player_id, display_name, category, questions_json, rounds_json,
          progress, correct_count, status, opponent_run_id, created_at, completed_at,
          rules_version, mini_game_id, mini_game_config_json, opponent_json,
          ghost_eligible
        FROM match_runs
        LIMIT 0
      `).all();

      if (!result.success) {
        throw new Error('D1 readiness check failed.');
      }

      return c.json({
        status: 'ok',
        timestamp: Date.now(),
        environment: c.env.ENVIRONMENT,
        checks: { d1: 'ok' },
      });
    } catch {
      return c.json({
        status: 'unavailable',
        timestamp: Date.now(),
        environment: c.env.ENVIRONMENT,
        checks: { d1: 'unavailable' },
      }, 503);
    }
  });
}
