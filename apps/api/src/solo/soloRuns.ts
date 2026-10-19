import type { Hono } from 'hono';
import type { Env } from '../env';
import { handleDuelBoard } from './duelBoard';
import { handleSoloLeaderboard } from './soloLeaderboard';
import { handleSoloAnswer, handleSoloHammer, settleHammerRow } from './soloRounds';
import { authenticate, openSoloRun, runIdParam, type AppContext } from './soloShared';
import { buildSoloSnapshot } from './soloSnapshot';
import { handleStartSoloRun } from './startSoloRun';
import { finalizeSoloRun } from './finalizeSoloRun';
import { listSoloRounds } from './soloRoundsRepository';

export function registerSoloRunRoutes(app: Hono<{ Bindings: Env }>): void {
  app.post('/api/solo-runs', handleStartSoloRun);
  app.post('/api/solo-runs/:id/answer', handleSoloAnswer);
  app.post('/api/solo-runs/:id/hammer', handleSoloHammer);
  app.post('/api/solo-runs/:id/abandon', handleAbandonSoloRun);
  app.get('/api/solo-runs/:id', handleResumeSoloRun);
  app.get('/api/solo-leaderboard', handleSoloLeaderboard);
  app.get('/api/duel-board', handleDuelBoard);
}

async function handleAbandonSoloRun(c: AppContext): Promise<Response> {
  const identity = await authenticate(c, 'solo-abandon');
  if (identity instanceof Response) return identity;
  const loaded = await openSoloRun(c, identity, runIdParam(c));
  if (loaded instanceof Response) return loaded;
  if (loaded.run.status === 'completed') {
    const result = await finalizeSoloRun(c, loaded, await listSoloRounds(c.env.DB, loaded.run.id));
    return result instanceof Response ? result : c.json(result);
  }

  let rows = await listSoloRounds(c.env.DB, loaded.run.id);
  const pendingIndex = rows.findIndex((row) => row.settled_at === null);
  if (pendingIndex >= 0) {
    const settled = await settleHammerRow(c, loaded, rows, pendingIndex, { kind: 'forfeit' });
    if (settled instanceof Response) return settled;
    rows = settled;
  }
  const result = await finalizeSoloRun(c, loaded, rows, { abandoned: true });
  return result instanceof Response ? result : c.json(result);
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
