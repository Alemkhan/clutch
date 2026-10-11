import {
  CURRENT_SOLO_RUN_CONDITIONS,
  FRIEND_RULES_VERSION,
  MAX_DAILY_SET_SIZE,
  PRACTICE_RULES_VERSION,
  SOLO_ROUND_CAP,
  SOLO_TARGET_PROGRESS,
  applySoloRound,
  compareSoloRuns,
  invertOutcome,
  dailyKey,
  createSoloRunState,
  isPracticeLevelId,
  evaluateSoloRun,
  setPar,
  soloScore,
  type AsyncMatchRound,
  type CompleteSoloRunResponse,
  type MyRunOutcome,
  type SoloLeaderboardResponse,
  type StartSoloRunResponse,
  type Question,
  type SkillResult,
} from '@clutch/shared';
import type { Context, Hono } from 'hono';
import { resolveRequestIdentity, type RequestIdentity } from '../auth/identity';
import type { Env } from '../env';
import { readJsonBody } from '../http/jsonBody';
import { checkRateLimit, RATE_LIMIT_PERIOD_SECONDS } from '../http/rateLimit';
import { PRACTICE_BOT_PROFILES, createBotOpponent } from '../matches/bots';
import { matchmake, pickSet } from '../matches/matchmaking';
import { currentMiniGameConfigJson, findRecordRun, findRun, findRunOwner, type GhostMatch } from '../matches/repository';
import { scoreSubmittedRound } from '../matches/scoring';
import {
  completeSoloRun,
  createSoloRun,
  findPaceResult,
  findSoloOutcome,
  soloLeaderboard,
} from '../matches/soloRepository';
import { categories, isRoundInput, isStartRequest, parseQuestions } from '../matches/validation';
import { notifyDuelResult, notifySoloResult } from '../notifications/outbid';
import {
  consumeInvite,
  findInvite,
  inviteMode,
  inviteUnavailableReason,
  isOpenInvite,
  releaseInvite,
  type InviteRow,
} from '../notifications/repository';

type AppContext = Context<{ Bindings: Env }>;

/** Работа после ответа через waitUntil; без execution context (тесты) просто запускается. */
function deferred(c: AppContext, work: Promise<unknown>): void {
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    void work;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_KEY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u;

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

export function registerSoloRunRoutes(app: Hono<{ Bindings: Env }>): void {
  app.post('/api/solo-runs', async (c) => {
    const identity = await authenticate(c, 'solo-start');
    if (identity instanceof Response) return identity;
    const parsed = await readJsonBody(c.req.raw, 1024);
    if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
    if (!isStartRequest(parsed.value)) {
      return c.json({ error: 'Invalid displayName or category.' }, 400);
    }
    const { displayName } = parsed.value;
    let category = parsed.value.category;
    const now = Date.now();
    const runId = crypto.randomUUID();

    // Тренировка: бот вместо записи игрока, вне соревнования (см. PRACTICE_RULES_VERSION).
    const requestedLevel = (parsed.value as { botLevel?: unknown }).botLevel;
    if (requestedLevel !== undefined) {
      if (!isPracticeLevelId(requestedLevel) || parsed.value.rematchInviteId) {
        return c.json({ error: 'Invalid botLevel.' }, 400);
      }
      // Тот же выбор набора, что в соревновании: увиденное в тренировке не должно
      // вернуться потом в зачётном забеге, поэтому набор запоминается за игроком.
      const { questionSetId, questions, bankExhausted } = await pickSet(
        c.env.DB,
        category,
        identity.playerId,
        now,
      );
      const bot = createBotOpponent(questions, PRACTICE_BOT_PROFILES[requestedLevel]);
      await createSoloRun(c.env.DB, {
        id: runId,
        playerId: identity.playerId,
        displayName: identity.displayName || displayName.trim(),
        category,
        questionSetId,
        questions,
        paceRunId: null,
        pace: bot,
        practice: true,
        now,
      });
      const practiceResponse: StartSoloRunResponse = {
        runId,
        questions,
        pace: bot,
        target: SOLO_TARGET_PROGRESS,
        roundCap: SOLO_ROUND_CAP,
        rulesVersion: PRACTICE_RULES_VERSION,
        bankExhausted,
      };
      return c.json(practiceResponse, 201);
    }

    // Реванш: приглашение должно быть адресовано игроку, не потрачено, не просрочено и из соло.
    // Категория берётся из приглашения, набор — обычным подбором (новый, не сыгранный получателем).
    // «Позвать друга» — открытое приглашение без адресата: его гасит первый, кто начал забег, и играет
    // против самой записи автора на её наборе. Эта запись зарезервирована и в общем подборе не участвует.
    let invite: InviteRow | null = null;
    let friendDuel = false;
    let record: GhostMatch | null = null;
    if (parsed.value.rematchInviteId) {
      invite = await findInvite(c.env.DB, parsed.value.rematchInviteId);
      if (!invite) return c.json({ error: 'Rematch invite not found.' }, 404);
      const friend = isOpenInvite(invite);
      friendDuel = friend;
      if (!friend && invite.recipient_player_id !== identity.playerId) {
        return c.json({ error: 'Rematch invite not found.' }, 404);
      }
      if (friend) {
        record = await findRecordRun(c.env.DB, invite.challenger_run_id, CURRENT_SOLO_RUN_CONDITIONS.rulesVersion);
        if (record?.row.player_id === identity.playerId) {
          return c.json({ error: 'This is your own invite.', reason: 'own' }, 403);
        }
      }
      const reason = inviteUnavailableReason(invite, now);
      if (reason || (friend && !record)) {
        return c.json({ error: 'Rematch invite is no longer available.', reason: reason ?? 'expired' }, 410);
      }
      if (inviteMode(invite) !== 'solo') {
        return c.json({ error: 'This rematch invite is for race mode.' }, 409);
      }
      category = invite.category as typeof category;
    }
    // Тот же подбор набора, что в гонке, но по соло-пулу: только забеги, дошедшие до цели.
    const { ghost, questionSetId, questions, bankExhausted } = record
      ? { ghost: record, questionSetId: record.questionSetId, questions: record.questions, bankExhausted: false }
      : await matchmake(
        c.env.DB,
        category,
        identity.playerId,
        now,
        { rulesVersion: CURRENT_SOLO_RUN_CONDITIONS.rulesVersion, reachedTargetOnly: true },
      );
    if (invite && !await consumeInvite(c.env.DB, invite.id, identity.playerId, runId)) {
      return c.json({ error: 'Rematch invite is no longer available.', reason: 'taken' }, 410);
    }
    try {
      await createSoloRun(c.env.DB, {
        id: runId,
        playerId: identity.playerId,
        displayName: identity.displayName || displayName.trim(),
        category,
        questionSetId,
        questions,
        paceRunId: ghost?.row.id ?? null,
        pace: ghost?.opponent ?? null,
        friend: friendDuel,
        now,
      });
    } catch (error) {
      if (invite) await releaseInvite(c.env.DB, invite.id).catch(() => undefined);
      throw error;
    }
    const response: StartSoloRunResponse = {
      runId,
      questions,
      pace: ghost?.opponent ?? null,
      target: SOLO_TARGET_PROGRESS,
      roundCap: SOLO_ROUND_CAP,
      rulesVersion: friendDuel ? FRIEND_RULES_VERSION : CURRENT_SOLO_RUN_CONDITIONS.rulesVersion,
      bankExhausted,
    };
    return c.json(response, 201);
  });

  app.post('/api/solo-runs/:id/complete', async (c) => {
    const identity = await authenticate(c, 'solo-complete');
    if (identity instanceof Response) return identity;
    const runId = c.req.param('id');
    const parsed = await readJsonBody(c.req.raw, 16_384);
    if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
    const body = parsed.value as { rounds?: unknown } | null;
    if (!body || typeof body !== 'object' || !Array.isArray(body.rounds)
      || body.rounds.length === 0 || body.rounds.length > MAX_DAILY_SET_SIZE
      || !body.rounds.every(isRoundInput)) {
      return c.json({ error: 'Invalid rounds.' }, 400);
    }
    const submittedRounds = body.rounds;

    const run = await findRun(c.env.DB, runId);
    if (!run || run.player_id !== identity.playerId) return c.json({ error: 'Run not found.' }, 404);
    const practice = run.rules_version === PRACTICE_RULES_VERSION;
    const friend = run.rules_version === FRIEND_RULES_VERSION;
    if ((!practice && !friend && run.rules_version !== CURRENT_SOLO_RUN_CONDITIONS.rulesVersion)
      || run.mini_game_config_json !== currentMiniGameConfigJson) {
      return c.json({ error: 'This is not a solo run.' }, 409);
    }
    const questions = parseQuestions(run.questions_json);
    if (!questions) return c.json({ error: 'Stored run questions are invalid.' }, 409);

    if (run.status === 'completed' && run.rounds_json) {
      return c.json(summary(
        runId,
        questions,
        JSON.parse(run.rounds_json) as AsyncMatchRound[],
        run.correct_count,
        await findSoloOutcome(c.env.DB, runId),
      ));
    }
    if (submittedRounds.length > questions.length) return c.json({ error: 'Too many rounds.' }, 400);

    // Темп (opponent_json) забег не завершает: ниже круги считаются только по ответам игрока.
    let state = createSoloRunState();
    let correctCount = 0;
    const previousSkillResults: SkillResult[] = [];
    const rounds: AsyncMatchRound[] = [];
    for (let index = 0; index < submittedRounds.length; index++) {
      const submitted = submittedRounds[index];
      const question = questions[index];
      if (submitted.questionId !== question.id) {
        return c.json({ error: `Unexpected question at round ${index + 1}.` }, 400);
      }
      const { correct, skillResult, progressAwarded } = scoreSubmittedRound(
        question,
        submitted,
        previousSkillResults,
      );
      if (correct) correctCount++;
      if (skillResult) previousSkillResults.push(skillResult);
      try {
        state = applySoloRound(state, {
          expectedQuestionId: question.id,
          round: { questionId: question.id, progressAwarded },
        });
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : 'Invalid run sequence.' }, 400);
      }
      rounds.push({
        questionId: question.id,
        correct,
        responseTimeMs: Math.round(Math.min(submitted.responseTimeMs, 60_000)),
        skillResult,
        progressAwarded,
        playerProgressAfter: state.progress,
      });
    }

    const result = summary(runId, questions, rounds, correctCount, null);
    // Забег закрывают только цель, потолок кругов или конец набора.
    if (evaluateSoloRun(questionIds(questions), soloRounds(rounds)).status !== 'completed') {
      return c.json({ error: 'The submitted rounds do not finish the run.' }, 400);
    }

    // Сравнение с записью-темпом. Нет записи — исход null, забег ждёт соперника.
    // Тренировка не сравнивается: бот — не запись игрока, а исход тренировки не хранится.
    const completedAt = Date.now();
    const pace = run.opponent_run_id && !practice ? await findPaceResult(c.env.DB, run.opponent_run_id) : null;
    const outcome = pace
      ? compareSoloRuns({
        reachedTarget: result.reachedTarget,
        progress: result.progress,
        roundsPlayed: result.roundsPlayed,
        soloScore: result.score,
        durationMs: Math.max(0, completedAt - run.created_at),
      }, pace)
      : null;
    result.outcome = outcome;

    const didComplete = await completeSoloRun(c.env.DB, {
      matchId: runId,
      rounds,
      progress: result.progress,
      correctCount,
      reachedTarget: result.reachedTarget,
      setPar: result.par,
      soloScore: result.score,
      outcome,
      practice,
      friend,
      now: completedAt,
    });
    if (!didComplete) {
      const stored = await findRun(c.env.DB, runId);
      if (stored?.status === 'completed' && stored.rounds_json) {
        return c.json(summary(
          runId,
          questions,
          JSON.parse(stored.rounds_json) as AsyncMatchRound[],
          stored.correct_count,
          await findSoloOutcome(c.env.DB, runId),
        ));
      }
      return c.json({ error: 'Run completion conflicted with another request.' }, 409);
    }
    // Владелец записи узнаёт исход в любом случае; повтор completion сюда не доходит.
    if (!practice && outcome && run.opponent_run_id) {
      const paceRunId = run.opponent_run_id;
      deferred(c, (async () => {
        const recipientRun = await findRunOwner(c.env.DB, paceRunId);
        if (!recipientRun) return;
        const recipientView = invertOutcome(outcome);
        // Дружеская дуэль: автор записи узнаёт итог, но реванш-приглашение ему не создаётся.
        const notify = friend ? notifyDuelResult : notifySoloResult;
        await notify(c.env, {
          recipientRun,
          challengerRunId: runId,
          challengerName: run.display_name,
          recipientProgress: pace?.progress ?? 0,
          challengerProgress: result.progress,
          outcome: recipientView === 'player' ? 'record_won' : recipientView === 'opponent' ? 'record_lost' : 'tie',
        });
      })().catch((error) => {
        console.error('Solo result lookup failed:', error instanceof Error ? error.message : 'unknown error');
      }));
    }
    return c.json(result);
  });

  // Таблица соло за сутки по UTC: лучший забег каждого игрока, только дошедшие до цели.
  app.get('/api/solo-leaderboard', async (c) => {
    const identity = await authenticate(c, 'solo-board');
    if (identity instanceof Response) return identity;
    const category = c.req.query('category') ?? 'geography';
    if (!categories.has(category)) return c.json({ error: 'Invalid category.' }, 400);
    const dateKey = c.req.query('date') ?? dailyKey(Date.now());
    const dayStart = DATE_KEY.test(dateKey) ? Date.parse(`${dateKey}T00:00:00Z`) : Number.NaN;
    if (!Number.isFinite(dayStart) || dailyKey(dayStart) !== dateKey) {
      return c.json({ error: 'Invalid date.' }, 400);
    }
    const entries = await soloLeaderboard(
      c.env.DB,
      category,
      CURRENT_SOLO_RUN_CONDITIONS.rulesVersion,
      dayStart,
      dayStart + DAY_MS,
    );
    const response: SoloLeaderboardResponse = {
      category: category as SoloLeaderboardResponse['category'],
      dateKey,
      entries,
    };
    return c.json(response);
  });
}

const questionIds = (questions: readonly Question[]) => questions.map((question) => question.id);
const soloRounds = (rounds: readonly AsyncMatchRound[]) =>
  rounds.map((round) => ({ questionId: round.questionId, progressAwarded: round.progressAwarded }));

/** Итог собирается только из кругов и правил shared; повтор completion даёт тот же ответ. */
function summary(
  runId: string,
  questions: readonly Question[],
  rounds: AsyncMatchRound[],
  correctCount: number,
  outcome: MyRunOutcome | null,
): CompleteSoloRunResponse {
  const final = evaluateSoloRun(questionIds(questions), soloRounds(rounds));
  const par = setPar(questions);
  return {
    runId,
    rounds,
    progress: final.progress,
    correctCount,
    roundsPlayed: final.roundsPlayed,
    reachedTarget: final.reachedTarget,
    par,
    score: soloScore(final.roundsPlayed, par),
    outcome,
  };
}
