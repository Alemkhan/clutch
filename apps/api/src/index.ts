import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import { registerAuthRoutes } from './routes/auth';
import { registerAsyncMatchRoutes } from './routes/asyncMatches';
import { registerLeaderboardRoutes } from './routes/leaderboard';
import { registerShareRoutes } from './routes/share';
import { registerSystemRoutes } from './routes/system';

const app = new Hono<{ Bindings: Env }>();

app.use('/api/*', cors({ allowHeaders: ['Content-Type', 'Authorization'] }));

registerSystemRoutes(app);
registerShareRoutes(app);
registerAuthRoutes(app);
registerAsyncMatchRoutes(app);
registerLeaderboardRoutes(app);

export { validateTelegramInitData } from './auth/telegram';
export default app;
