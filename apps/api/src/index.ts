import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import { registerAsyncMatchRoutes } from './routes/asyncMatches';
import { registerLeaderboardRoutes } from './routes/leaderboard';

const app = new Hono<{ Bindings: Env }>();

app.use('/api/*', cors());

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

app.get('/api/tournaments/:slug', (c) => c.json({
  slug: c.req.param('slug'),
  message: 'Tournament endpoint ready. Connect D1 to return real data.',
}));

registerAsyncMatchRoutes(app);
registerLeaderboardRoutes(app);

export { validateTelegramInitData } from './auth/telegram';
export default app;
