import {
  CURRENT_SOLO_RUN_CONDITIONS,
  SOLO_ROUND_CAP,
  SOLO_TARGET_PROGRESS,
  evaluateSoloRun,
  type MiniGameId,
  toPublicQuestion,
  type CompleteSoloRunResponse,
  type SoloPlayedRound,
  type SoloRunSnapshot,
} from '@clutch/shared';
import type { Hono } from 'hono';
import type { Env } from '../env';
import { finalizeSoloRun } from './finalizeSoloRun';
import { findRunOwner } from './repository';
import { listSoloRounds } from './soloRoundsRepository';
import { handleSoloLeaderboard } from './soloLeaderboard';
import { handleSoloAnswer, handleSoloHammer, settleHammerRow } from './soloRounds';
import { authenticate, openSoloRun, parsePace, runIdParam, questionIds, settledRounds, type AppContext } from './soloShared';
import { handleStartSoloRun } from './startSoloRun';

export function registerSoloRunRoutes(app: Hono<{ Bindings: Env }>): void {
  app.post('/api/solo-runs', handleStartSoloRun);
  app.post('/api/solo-runs/:id/answer', handleSoloAnswer);
  app.post('/api/solo-runs/:id/hammer', handleSoloHammer);
  app.get('/api/solo-runs/:id', handleResumeSoloRun);
  app.get('/api/solo-leaderboard', handleSoloLeaderboard);
}

// Продолжение забега после закрытой вкладки: вопросы без ответов и уже сыгранные круги.
// Верный ответ без удара засчитывается промахом: повторного удара по тому же вопросу не будет.
async function handleResumeSoloRun(c: AppContext): Promise<Response> {
  const identity = await authenticate(c, 'solo-resume');
  if (identity instanceof Response) return identity;
  const loaded = await openSoloRun(c, identity, runIdParam(c));
  if (loaded instanceof Response) return loaded;
  const { run, questions } = loaded;
  let rows = await listSoloRounds(c.env.DB, run.id);

  const pendingIndex = rows.findIndex((row) => row.settled_at === null);
  if (pendingIndex >= 0 && run.status === 'in_progress') {
    const settled = await settleHammerRow(c, run, questions, rows, pendingIndex, { kind: 'forfeit' });
    if (settled instanceof Response) return settled;
    rows = settled;
  }
  const state = evaluateSoloRun(questionIds(questions), settledRounds(rows));
  let result: CompleteSoloRunResponse | null = null;
  if (state.status === 'completed') {
    const finished = await finalizeSoloRun(c, loaded, rows);
    if (finished instanceof Response) return finished;
    result = finished;
  }
  const owner = await findRunOwner(c.env.DB, run.id);
  const snapshot: SoloRunSnapshot = {
    runId: run.id,
    category: (owner?.category ?? 'general') as SoloRunSnapshot['category'],
    questions: questions.map(toPublicQuestion),
    pace: parsePace(run.opponent_json),
    // Соперника отпустили, пока игрока не было: экран должен сказать об этом прямо.
    ...(run.pace_released === 1 ? { paceReleased: true } : {}),
    target: SOLO_TARGET_PROGRESS,
    roundCap: SOLO_ROUND_CAP,
    rulesVersion: run.rules_version ?? CURRENT_SOLO_RUN_CONDITIONS.rulesVersion,
    miniGameId: run.mini_game_id as MiniGameId,
    bankExhausted: false,
    rounds: rows.filter((row) => row.settled_at !== null).map((row): SoloPlayedRound => ({
      questionId: row.question_id,
      correct: row.correct === 1,
      skillResult: row.skill_result,
      progressAwarded: row.progress_awarded ?? 0,
      responseTimeMs: row.response_time_ms,
    })),
    status: state.status,
    result,
  };
  return c.json(snapshot);
}
