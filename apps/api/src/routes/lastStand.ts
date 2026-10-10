import {
  baseTimeMs,
  dailyKey,
  roundDeadlineMs,
  submitLastStandAnswer,
  type LastStandRound,
  type LastStandState,
  type RecordedAnswer,
} from '@clutch/shared';
import type { Context, Hono } from 'hono';
import { resolveRequestIdentity, type RequestIdentity } from '../auth/identity';
import type { Env } from '../env';
import { readJsonBody } from '../http/jsonBody';
import { checkRateLimit, RATE_LIMIT_PERIOD_SECONDS } from '../http/rateLimit';
import { pickFillerBots } from '../lastStand/bots';
import { recogniseCountry } from '../lastStand/normalize';
import { countryNameRu, planForDate, roundTitleRu } from '../lastStand/plan';
import {
  createRun,
  findPoolOpponents,
  findRun,
  leaderboard,
  parseAnswers,
  parseOpponents,
  saveAccepted,
  saveCollision,
  saveEliminated,
} from '../lastStand/repository';

const OPPONENT_COUNT = 2;
/** atMs is client-reported (same trust boundary as the match); bounded, never trusted further. */
const MAX_AT_MS = 120_000;
const MAX_DISPLAY_NAME = 40;

type AppContext = Context<{ Bindings: Env }>;

interface RoundView {
  index: number;
  scale: LastStandRound['scale'];
  titleRu: string;
  timeMs: number;
}

/** Never includes `members`: the roster is checked on the server only. */
function roundView(round: LastStandRound): RoundView {
  return {
    index: round.index,
    scale: round.scale,
    titleRu: roundTitleRu(round),
    timeMs: baseTimeMs(round.scale),
  };
}

async function authenticate(c: AppContext, scope: string): Promise<RequestIdentity | Response> {
  const identity = await resolveRequestIdentity(c.req.header('Authorization'), c.env);
  if (!identity) return c.json({ error: 'Authentication required.' }, 401);
  const rateLimit = await checkRateLimit(c.env.API_RATE_LIMITER, `${scope}:${identity.playerId}`);
  if (rateLimit === 'limited') {
    c.header('Retry-After', String(RATE_LIMIT_PERIOD_SECONDS));
    return c.json({ error: 'Too many requests.' }, 429);
  }
  if (rateLimit === 'unavailable') return c.json({ error: 'Rate limiter unavailable.' }, 503);
  return identity;
}

function validDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function registerLastStandRoutes(app: Hono<{ Bindings: Env }>): void {
  app.post('/api/last-stand/start', async (c) => {
    const auth = await authenticate(c, 'ls-start');
    if (auth instanceof Response) return auth;
    const identity = auth;

    // The body is optional; it only supplies a name for guests who have none.
    let bodyName = '';
    if ((await c.req.raw.clone().text()).trim().length > 0) {
      const parsed = await readJsonBody(c.req.raw, 1024);
      if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
      const value = parsed.value as { displayName?: unknown } | null;
      if (value && typeof value === 'object' && typeof value.displayName === 'string') {
        bodyName = value.displayName.trim().slice(0, MAX_DISPLAY_NAME);
      }
    }
    const displayName = identity.displayName?.trim().slice(0, MAX_DISPLAY_NAME) || bodyName || 'Игрок';

    const now = Date.now();
    const dateKey = dailyKey(now);
    const rounds = planForDate(dateKey);
    const pool = await findPoolOpponents(c.env.DB, dateKey, identity.playerId, OPPONENT_COUNT);
    const opponents = [
      ...pool,
      ...pickFillerBots(OPPONENT_COUNT - pool.length, dateKey, identity.playerId, rounds),
    ];

    const runId = crypto.randomUUID();
    await createRun(c.env.DB, {
      id: runId,
      playerId: identity.playerId,
      displayName,
      dateKey,
      opponents,
      createdAt: now,
    });

    return c.json({
      runId,
      dateKey,
      opponents: opponents.map((opponent) => ({
        displayName: opponent.displayName,
        // Additive to the agreed contract: lets the client avoid presenting a bot as a person.
        source: opponent.source,
      })),
      round: roundView(rounds[0]),
    }, 201);
  });

  app.post('/api/last-stand/:runId/answer', async (c) => {
    const auth = await authenticate(c, 'ls-answer');
    if (auth instanceof Response) return auth;
    const identity = auth;

    const parsed = await readJsonBody(c.req.raw, 1024);
    if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
    const body = parsed.value as { answer?: unknown; atMs?: unknown } | null;
    if (!body || typeof body !== 'object' || typeof body.answer !== 'string'
      || typeof body.atMs !== 'number' || !Number.isFinite(body.atMs)) {
      return c.json({ error: 'Invalid answer or atMs.' }, 400);
    }
    const atMs = Math.round(Math.min(MAX_AT_MS, Math.max(0, body.atMs)));

    const run = await findRun(c.env.DB, c.req.param('runId'));
    if (!run || run.player_id !== identity.playerId) {
      return c.json({ error: 'Run not found.' }, 404);
    }
    if (run.status !== 'in_progress') return c.json({ error: 'Run is already finished.' }, 409);

    const opponents = parseOpponents(run.opponents_json);
    const answers = parseAnswers(run.answers_json);
    if (!opponents || !answers) return c.json({ error: 'Stored run is invalid.' }, 409);

    const rounds = planForDate(run.date_key);
    if (run.survived >= rounds.length) return c.json({ error: 'Stored run is invalid.' }, 409);
    const state: LastStandState = {
      dateKey: run.date_key,
      rounds,
      roundIndex: run.survived,
      survived: run.survived,
      collisions: run.collisions,
      status: 'playing',
      eliminatedBy: null,
    };
    const round = rounds[run.survived];
    const records: (RecordedAnswer | null)[] = opponents.map(
      (opponent) => opponent.answers[run.survived] ?? null,
    );
    const code = recogniseCountry(body.answer, round.members);
    const { state: next, resolution } = submitLastStandAnswer(state, { answer: code, atMs, records });
    if (!resolution) return c.json({ error: 'Run is already finished.' }, 409);

    const reveal = () => opponents.flatMap((opponent) => {
      const record = opponent.answers[run.survived];
      return record
        ? [{ displayName: opponent.displayName, answerRu: countryNameRu(record.answer), atMs: record.atMs }]
        : [];
    });
    const conflict = () => c.json({ error: 'Answer conflicted with another request.' }, 409);
    const now = Date.now();

    switch (resolution.kind) {
      case 'invalid':
        return c.json({
          status: 'invalid',
          reason: null,
          deadlineMs: roundDeadlineMs(round, run.collisions),
          reveal: [],
          survived: run.survived,
          round: roundView(round),
        });
      case 'occupied': {
        if (!await saveCollision(c.env.DB, run, resolution.collisions)) return conflict();
        return c.json({
          status: 'occupied',
          reason: null,
          deadlineMs: resolution.deadlineMs,
          reveal: [],
          survived: run.survived,
          round: roundView(round),
        });
      }
      case 'eliminated': {
        if (!await saveEliminated(c.env.DB, run, resolution.reason, now)) return conflict();
        return c.json({
          status: 'eliminated',
          reason: resolution.reason,
          deadlineMs: roundDeadlineMs(round, run.collisions),
          reveal: reveal(),
          survived: run.survived,
          round: null,
        });
      }
      case 'accepted': {
        const stored = [...answers];
        while (stored.length < run.survived) stored.push(null);
        stored[run.survived] = { answer: resolution.answer, atMs };
        const cleared = next.status === 'cleared';
        if (!await saveAccepted(c.env.DB, run, stored, cleared, now)) return conflict();
        return c.json({
          status: cleared ? 'cleared' : 'accepted',
          reason: null,
          deadlineMs: roundDeadlineMs(round, run.collisions),
          reveal: reveal(),
          survived: next.survived,
          round: cleared ? null : roundView(rounds[next.roundIndex]),
        });
      }
    }
  });

  app.get('/api/last-stand/leaderboard', async (c) => {
    const auth = await authenticate(c, 'ls-board');
    if (auth instanceof Response) return auth;
    const dateKey = c.req.query('date') ?? dailyKey(Date.now());
    if (!validDateKey(dateKey)) return c.json({ error: 'Invalid date.' }, 400);
    return c.json({ dateKey, entries: await leaderboard(c.env.DB, dateKey) });
  });
}
