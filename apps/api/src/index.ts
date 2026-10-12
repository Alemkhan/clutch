import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import { releaseExpiredRematchInvites } from './notifications/expiry';
import { registerAuthRoutes } from './routes/auth';
import { registerLastStandRoutes } from './routes/lastStand';
import { registerLeaderboardRoutes } from './routes/leaderboard';
import { registerRematchRoutes } from './routes/rematch';
import { registerMyRunsRoutes } from './routes/myRuns';
import { registerSoloRunRoutes } from './routes/soloRuns';
import { registerTrainingRoutes } from './routes/training';
import { registerFriendInviteRoutes } from './routes/friendInvites';
import { registerShareRoutes } from './routes/share';
import { registerSystemRoutes } from './routes/system';

const app = new Hono<{ Bindings: Env }>();

app.use('/api/*', cors({ allowHeaders: ['Content-Type', 'Authorization'] }));

registerSystemRoutes(app);
registerShareRoutes(app);
registerAuthRoutes(app);
registerLeaderboardRoutes(app);
registerRematchRoutes(app);
registerMyRunsRoutes(app);
registerSoloRunRoutes(app);
registerTrainingRoutes(app);
registerFriendInviteRoutes(app);
registerLastStandRoutes(app);

export { validateTelegramInitData } from './auth/telegram';
// Тот же Hono-app (fetch и app.request не меняются) плюс плановый обработчик cron.
export default Object.assign(app, {
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const summary = await releaseExpiredRematchInvites(env.DB, Date.now());
    console.log('rematch expiry', JSON.stringify(summary));
  },
});
