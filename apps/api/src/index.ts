import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import { releaseExpiredRematchInvites } from './notifications/expiry';
import { registerAuthRoutes } from './auth/auth';
import { registerLastStandRoutes } from './lastStand/lastStand';
import { registerRematchRoutes } from './rematch/rematch';
import { registerMyRunsRoutes } from './myRuns/myRuns';
import { registerSoloRunRoutes } from './solo/soloRuns';
import { registerTrainingRoutes } from './training/training';
import { registerFriendInviteRoutes } from './rematch/friendInvites';
import { registerShareRoutes } from './share/share';
import { registerSystemRoutes } from './http/system';
import { registerProfileRoutes } from './profile/profile';
import { registerTelemetryRoutes } from './telemetry/telemetry';
import { registerTiebreakerRoutes } from './tiebreaker/tiebreaker';

const app = new Hono<{ Bindings: Env }>();

app.use('/api/*', cors({ allowHeaders: ['Content-Type', 'Authorization'] }));

registerSystemRoutes(app);
registerShareRoutes(app);
registerAuthRoutes(app);
registerRematchRoutes(app);
registerMyRunsRoutes(app);
registerProfileRoutes(app);
registerTelemetryRoutes(app);
registerTiebreakerRoutes(app);
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
