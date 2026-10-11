import {
  CURRENT_ASYNC_MATCH_CONDITIONS,
  evaluateMatch,
  MAX_DAILY_SET_SIZE,
  type AsyncMatchRound,
  type CompleteAsyncMatchRequest,
  type CompleteAsyncMatchResponse,
  type StartAsyncMatchRequest,
  type StartAsyncMatchResponse,
  type SkillResult,
} from '@clutch/shared';
import type { Context, Hono } from 'hono';
import { resolveRequestIdentity } from '../auth/identity';
import type { Env } from '../env';
import { readJsonBody } from '../http/jsonBody';
import { checkRateLimit, RATE_LIMIT_PERIOD_SECONDS } from '../http/rateLimit';
import { createBotOpponent, pickBotProfile } from '../matches/bots';
import { matchmake } from '../matches/matchmaking';
import { scoreSubmittedRound } from '../matches/scoring';
import {
  completeRun,
  createMatchRun,
  currentMiniGameConfigJson,
  findRunOwner,
  findRun,
} from '../matches/repository';
import { notifyOutbid } from '../notifications/outbid';
import { consumeInvite, findInvite, inviteMode, releaseInvite, type InviteRow } from '../notifications/repository';
import {
  isRoundInput,
  isStartRequest,
  parseQuestions,
  validOpponentForQuestions,
} from '../matches/validation';

/** Keeps work alive after the response via waitUntil; without an execution context (tests) it just runs. */
function deferred(c: Context<{ Bindings: Env }>, work: Promise<unknown>): void {
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    void work;
  }
}

export function registerAsyncMatchRoutes(app: Hono<{ Bindings: Env }>): void {
  app.post('/api/async-matches', async (c) => {
    const identity = await resolveRequestIdentity(c.req.header('Authorization'), c.env);
    if (!identity) return c.json({ error: 'Authentication required.' }, 401);
    const rateLimit = await checkRateLimit(c.env.API_RATE_LIMITER, `start:${identity.playerId}`);
    if (rateLimit === 'limited') {
      c.header('Retry-After', String(RATE_LIMIT_PERIOD_SECONDS));
      return c.json({ error: 'Too many requests.' }, 429);
    }
    if (rateLimit === 'unavailable') return c.json({ error: 'Rate limiter unavailable.' }, 503);
    const parsed = await readJsonBody(c.req.raw, 1024);
    if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
    const body = parsed.value;
    if (!isStartRequest(body)) {
      return c.json({ error: 'Invalid displayName or category.' }, 400);
    }

    const playerId = identity.playerId;
    const displayName = identity.displayName || body.displayName.trim();

    // Реванш отличается от обычного старта только категорией из приглашения: набор тот же
    // подбор, то есть новый, ещё не сыгранный получателем.
    const matchId = crypto.randomUUID();
    let category = body.category;
    let invite: InviteRow | null = null;
    if (body.rematchInviteId) {
      invite = await findInvite(c.env.DB, body.rematchInviteId);
      if (!invite || invite.recipient_player_id !== playerId) {
        return c.json({ error: 'Rematch invite not found.' }, 404);
      }
      if (invite.consumed_at !== null || invite.expires_at <= Date.now()) {
        return c.json({ error: 'Rematch invite is no longer available.' }, 410);
      }
      if (inviteMode(invite) !== 'race') {
        return c.json({ error: 'This rematch invite is for solo mode.' }, 409);
      }
      category = invite.category as StartAsyncMatchRequest['category'];
    }
    const { ghost, questionSetId, questions, bankExhausted } = await matchmake(c.env.DB, category, playerId, Date.now());
    if (invite && !await consumeInvite(c.env.DB, invite.id, playerId, matchId)) {
      return c.json({ error: 'Rematch invite is no longer available.' }, 410);
    }
    const opponent = ghost?.opponent ?? createBotOpponent(questions, pickBotProfile(questionSetId, playerId));

    try {
      await createMatchRun(c.env.DB, {
        id: matchId,
        playerId,
        displayName,
        category,
        questionSetId,
        questions,
        opponentRunId: ghost?.row.id ?? null,
        opponent,
      });
    } catch (error) {
      if (invite) await releaseInvite(c.env.DB, invite.id).catch(() => undefined);
      throw error;
    }

    const response: StartAsyncMatchResponse = {
      matchId,
      questions,
      opponent,
      opponentSource: ghost ? 'player' : 'bot',
      conditions: CURRENT_ASYNC_MATCH_CONDITIONS,
      bankExhausted,
    };
    return c.json(response, 201);
  });

  app.post('/api/async-matches/:id/complete', async (c) => {
    const identity = await resolveRequestIdentity(c.req.header('Authorization'), c.env);
    if (!identity) return c.json({ error: 'Authentication required.' }, 401);
    const rateLimit = await checkRateLimit(c.env.API_RATE_LIMITER, `complete:${identity.playerId}`);
    if (rateLimit === 'limited') {
      c.header('Retry-After', String(RATE_LIMIT_PERIOD_SECONDS));
      return c.json({ error: 'Too many requests.' }, 429);
    }
    if (rateLimit === 'unavailable') return c.json({ error: 'Rate limiter unavailable.' }, 503);
    const matchId = c.req.param('id');
    const parsed = await readJsonBody(c.req.raw, 16_384);
    if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
    const body = parsed.value as CompleteAsyncMatchRequest;
    if (!body || typeof body !== 'object' || !Array.isArray(body.rounds)
      || body.rounds.length === 0
      || body.rounds.length > MAX_DAILY_SET_SIZE
      || !body.rounds.every(isRoundInput)) {
      return c.json({ error: 'Invalid rounds.' }, 400);
    }

    const run = await findRun(c.env.DB, matchId);
    if (!run || run.player_id !== identity.playerId) {
      return c.json({ error: 'Match not found.' }, 404);
    }

    if (run.status === 'completed' && run.rounds_json) {
      return c.json(completedResponse(
        matchId,
        run.rounds_json,
        run.progress,
        run.correct_count,
      ));
    }

    if (run.rules_version !== CURRENT_ASYNC_MATCH_CONDITIONS.rulesVersion
      || run.mini_game_id !== CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.id
      || run.mini_game_config_json !== currentMiniGameConfigJson
      || !run.opponent_json) {
      return c.json({ error: 'This match uses unsupported or legacy conditions. Please start a new match.' }, 409);
    }

    const questions = parseQuestions(run.questions_json);
    if (!questions) return c.json({ error: 'Stored match questions are invalid.' }, 409);
    if (body.rounds.length > questions.length) return c.json({ error: 'Too many rounds.' }, 400);

    let progress = 0;
    let correctCount = 0;
    const previousSkillResults: SkillResult[] = [];
    const rounds: AsyncMatchRound[] = [];
    for (let index = 0; index < body.rounds.length; index++) {
      const submitted = body.rounds[index];
      const question = questions[index];
      if (!question || submitted.questionId !== question.id) {
        return c.json({ error: `Unexpected question at round ${index + 1}.` }, 400);
      }
      const { correct, skillResult, progressAwarded } = scoreSubmittedRound(
        question,
        submitted,
        previousSkillResults,
      );
      if (correct) correctCount++;
      if (skillResult) previousSkillResults.push(skillResult);
      progress = Math.min(100, progress + progressAwarded);
      rounds.push({
        questionId: question.id,
        correct,
        responseTimeMs: Math.round(Math.min(submitted.responseTimeMs, 60_000)),
        skillResult,
        progressAwarded,
        playerProgressAfter: progress,
      });
    }

    let opponent: unknown;
    try {
      opponent = JSON.parse(run.opponent_json);
    } catch {
      return c.json({ error: 'Stored opponent snapshot is invalid.' }, 409);
    }
    if (!validOpponentForQuestions(opponent, questions)) {
      return c.json({ error: 'Stored opponent snapshot is invalid.' }, 409);
    }

    let matchState;
    try {
      matchState = evaluateMatch(
        questions.map((question) => question.id),
        rounds,
        opponent.rounds,
        { frozenOpponent: true },
      );
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Invalid match sequence.' }, 400);
    }
    if (matchState.status !== 'completed') {
      return c.json({ error: 'The submitted rounds do not complete the match.' }, 400);
    }

    const didComplete = await completeRun(c.env.DB, {
      matchId,
      rounds,
      progress,
      correctCount,
      ghostEligible: matchState.ghostEligible,
    });
    if (!didComplete) {
      const stored = await findRun(c.env.DB, matchId);
      if (stored?.status === 'completed' && stored.rounds_json) {
        return c.json(completedResponse(
          matchId,
          stored.rounds_json,
          stored.progress,
          stored.correct_count,
        ));
      }
      return c.json({ error: 'Match completion conflicted with another request.' }, 409);
    }

    // Only a real recorded opponent can be outbid, and only by winning outright.
    if (run.opponent_run_id && matchState.outcome === 'player') {
      const challengerName = run.display_name;
      const challengerProgress = progress;
      const recipientProgress = matchState.opponentProgress;
      const opponentRunId = run.opponent_run_id;
      deferred(c, (async () => {
        const recipientRun = await findRunOwner(c.env.DB, opponentRunId);
        if (!recipientRun) return;
        await notifyOutbid(c.env, {
          recipientRun,
          challengerRunId: matchId,
          challengerName,
          recipientProgress,
          challengerProgress,
        });
      })().catch((error) => {
        console.error('Outbid lookup failed:', error instanceof Error ? error.message : 'unknown error');
      }));
    }

    const response: CompleteAsyncMatchResponse = {
      matchId,
      rounds,
      playerProgress: progress,
      correctCount,
    };
    return c.json(response);
  });
}

function completedResponse(
  matchId: string,
  roundsJson: string,
  progress: number,
  correctCount: number,
): CompleteAsyncMatchResponse {
  return {
    matchId,
    rounds: JSON.parse(roundsJson) as AsyncMatchRound[],
    playerProgress: progress,
    correctCount,
  };
}
