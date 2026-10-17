import type { Hono } from 'hono';
import type { Env } from '../env';
import { handleSoloLeaderboard } from './soloLeaderboard';
import { handleSoloAnswer, handleSoloHammer } from './soloRounds';
import { authenticate, openSoloRun, runIdParam, type AppContext } from './soloShared';
import { buildSoloSnapshot } from './soloSnapshot';
import { handleStartSoloRun } from './startSoloRun';

export function registerSoloRunRoutes(app: Hono<{ Bindings: Env }>): void {
  app.post('/api/solo-runs', handleStartSoloRun);
  app.post('/api/solo-runs/:id/answer', handleSoloAnswer);
  app.post('/api/solo-runs/:id/hammer', handleSoloHammer);
  app.get('/api/solo-runs/:id', handleResumeSoloRun);
  app.get('/api/solo-leaderboard', handleSoloLeaderboard);
}

// Продолжение забега после закрытой вкладки: снимок собирает buildSoloSnapshot (общий со стартом).
async function handleResumeSoloRun(c: AppContext): Promise<Response> {
  const identity = await authenticate(c, 'solo-resume');
  if (identity instanceof Response) return identity;
  const loaded = await openSoloRun(c, identity, runIdParam(c));
  if (loaded instanceof Response) return loaded;
  const snapshot = await buildSoloSnapshot(c, loaded);
  if (snapshot instanceof Response) return snapshot;
  return c.json(snapshot);
}
