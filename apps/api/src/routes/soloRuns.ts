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
  isPracticeLevelId,
  evaluateSoloRun,
  setPar,
  soloScore,
  toPublicQuestion,
  type AsyncMatchRound,
  type CompleteSoloRunResponse,
  type MyRunOutcome,
  type Opponent,
  type SoloAnswerRequest,
  type SoloHammerRequest,
  type SoloLeaderboardResponse,
  type SoloPlayedRound,
  type SoloRoundResponse,
  type SoloRunSnapshot,
  type StartSoloRunResponse,
  type Question,
} from '@clutch/shared';
import type { Context, Hono } from 'hono';
import { resolveRequestIdentity, type RequestIdentity } from '../auth/identity';
import type { Env } from '../env';
import { readJsonBody } from '../http/jsonBody';
import { checkRateLimit, RATE_LIMIT_PERIOD_SECONDS } from '../http/rateLimit';
import { PRACTICE_BOT_PROFILES, createBotOpponent } from '../matches/bots';
import { matchmake, pickSet } from '../matches/matchmaking';
import { currentMiniGameConfigJson, findRecordRun, findRun, findRunOwner, type GhostMatch } from '../matches/repository';
import { recordMistake } from '../matches/mistakesRepository';
import { scoreSubmittedRound } from '../matches/scoring';
import { insertSoloAnswer, listSoloRounds, settleSoloHammer, type SoloRoundRow } from '../matches/soloRoundsRepository';
import type { RunRow } from '../matches/types';
import {
  completeSoloRun,
  createSoloRun,
  findPaceResult,
  findSoloOutcome,
  soloLeaderboard,
} from '../matches/soloRepository';
import { categories, correctFor, isRoundInput, isStartRequest, parseQuestions } from '../matches/validation';
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
        questions: questions.map(toPublicQuestion),
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
      questions: questions.map(toPublicQuestion),
      pace: ghost?.opponent ?? null,
      target: SOLO_TARGET_PROGRESS,
      roundCap: SOLO_ROUND_CAP,
      rulesVersion: friendDuel ? FRIEND_RULES_VERSION : CURRENT_SOLO_RUN_CONDITIONS.rulesVersion,
      bankExhausted,
    };
    return c.json(response, 201);
  });

  // Круг соло-забега, шаг 1: ответ. Сервер проверяет его и возвращает верность и правильный ответ.
  // Неверный ответ закрывает круг с нулём; верный ждёт удар (шаг 2). Повтор отдаёт уже записанное.
  app.post('/api/solo-runs/:id/answer', async (c) => {
    const identity = await authenticate(c, 'solo-round');
    if (identity instanceof Response) return identity;
    const parsed = await readJsonBody(c.req.raw, 1024);
    if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
    if (!isAnswerRequest(parsed.value)) return c.json({ error: 'Invalid answer.' }, 400);
    const body = parsed.value;

    const loaded = await openSoloRun(c, identity, c.req.param('id'));
    if (loaded instanceof Response) return loaded;
    const { run, questions } = loaded;
    let rows = await listSoloRounds(c.env.DB, run.id);

    if (body.roundIndex < rows.length) {
      if (rows[body.roundIndex].question_id !== body.questionId) {
        return c.json({ error: 'Unexpected question for this round.' }, 400);
      }
      return respondWithRound(c, loaded, rows, body.roundIndex);
    }
    if (body.roundIndex > rows.length) {
      return c.json({ error: 'Rounds must be sent in order.', reason: 'out_of_order' }, 409);
    }
    if (rows.some((row) => row.settled_at === null)) {
      return c.json({ error: 'The previous round is waiting for its hammer.', reason: 'hammer_pending' }, 409);
    }
    const prior = evaluateSoloRun(questionIds(questions), settledRounds(rows));
    if (run.status === 'completed' || prior.status === 'completed') {
      return c.json({ error: 'The run is already finished.', reason: 'completed' }, 409);
    }
    const question = questions[body.roundIndex];
    if (!question || question.id !== body.questionId) {
      return c.json({ error: 'Unexpected question for this round.' }, 400);
    }

    const correct = correctFor(question, body.selectedAnswer);
    const settledProgressAfter = correct
      ? null
      : applySoloRound(prior, {
        expectedQuestionId: question.id,
        round: { questionId: question.id, progressAwarded: 0 },
      }).progress;
    // Если параллельный запрос успел раньше, вставка ничего не изменит и ниже вернётся записанное им.
    const inserted = await insertSoloAnswer(c.env.DB, {
      runId: run.id,
      roundIndex: body.roundIndex,
      questionId: question.id,
      selectedAnswer: body.selectedAnswer,
      responseTimeMs: Math.min(body.responseTimeMs, 60_000),
      correct,
      settledProgressAfter,
      now: Date.now(),
    });
    // Ошибка пишется в журнал игрока ровно один раз: повтор запроса вставку не проходит (inserted = false).
    // Пишем и тренировочные, и дружеские забеги: сервер всё равно показал игроку верный ответ.
    if (inserted && !correct) await recordMistake(c.env.DB, identity.playerId, question.id, Date.now());
    rows = await listSoloRounds(c.env.DB, run.id);
    return respondWithRound(c, loaded, rows, body.roundIndex);
  });

  // Круг соло-забега, шаг 2: удар по верному ответу. skillDistance присылает клиент (граница доверия).
  app.post('/api/solo-runs/:id/hammer', async (c) => {
    const identity = await authenticate(c, 'solo-round');
    if (identity instanceof Response) return identity;
    const parsed = await readJsonBody(c.req.raw, 1024);
    if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
    if (!isHammerRequest(parsed.value)) return c.json({ error: 'Invalid hammer result.' }, 400);
    const body = parsed.value;

    const loaded = await openSoloRun(c, identity, c.req.param('id'));
    if (loaded instanceof Response) return loaded;
    const { run, questions } = loaded;
    let rows = await listSoloRounds(c.env.DB, run.id);
    const row = rows[body.roundIndex];
    if (!row) return c.json({ error: 'Answer this round first.', reason: 'out_of_order' }, 409);
    if (row.question_id !== body.questionId) {
      return c.json({ error: 'Unexpected question for this round.' }, 400);
    }
    if (row.correct !== 1) return c.json({ error: 'Only a correct answer earns a hammer.', reason: 'not_correct' }, 409);

    if (row.settled_at === null) {
      const settled = await settleHammerRow(c, run, questions, rows, body.roundIndex, body.skillDistance);
      if (settled instanceof Response) return settled;
      rows = settled;
    }
    return respondWithRound(c, loaded, rows, body.roundIndex);
  });

  // Продолжение забега после закрытой вкладки: вопросы без ответов и уже сыгранные круги.
  // Верный ответ без удара засчитывается промахом: повторного удара по тому же вопросу не будет.
  app.get('/api/solo-runs/:id', async (c) => {
    const identity = await authenticate(c, 'solo-resume');
    if (identity instanceof Response) return identity;
    const loaded = await openSoloRun(c, identity, c.req.param('id'));
    if (loaded instanceof Response) return loaded;
    const { run, questions } = loaded;
    let rows = await listSoloRounds(c.env.DB, run.id);

    const pendingIndex = rows.findIndex((row) => row.settled_at === null);
    if (pendingIndex >= 0 && run.status === 'in_progress') {
      const settled = await settleHammerRow(c, run, questions, rows, pendingIndex, 1);
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
      target: SOLO_TARGET_PROGRESS,
      roundCap: SOLO_ROUND_CAP,
      rulesVersion: run.rules_version ?? CURRENT_SOLO_RUN_CONDITIONS.rulesVersion,
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
  });

  // Таблица соло за сутки по UTC: лучший забег каждого игрока, только дошедшие до цели.
  app.get('/api/solo-leaderboard', async (c) => {
    const identity = await authenticate(c, 'solo-board');
    if (identity instanceof Response) return identity;
    const category = c.req.query('category') ?? 'general';
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

const soloRounds = (rounds: readonly AsyncMatchRound[]) =>
  rounds.map((round) => ({ questionId: round.questionId, progressAwarded: round.progressAwarded }));

const questionIds = (questions: readonly Question[]) => questions.map((question) => question.id);

/** Только закрытые круги: ожидающий удара прогресс не меняет. */
function settledRounds(rows: readonly SoloRoundRow[]) {
  return rows
    .filter((row) => row.settled_at !== null)
    .map((row) => ({ questionId: row.question_id, progressAwarded: row.progress_awarded ?? 0 }));
}

const storedRounds = (rows: readonly SoloRoundRow[]): AsyncMatchRound[] => rows.map((row) => ({
  questionId: row.question_id,
  correct: row.correct === 1,
  responseTimeMs: row.response_time_ms,
  skillResult: row.skill_result ?? undefined,
  progressAwarded: row.progress_awarded ?? 0,
  playerProgressAfter: row.progress_after ?? 0,
}));

function parsePace(value: string | null): Opponent | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as Opponent;
  } catch {
    return null;
  }
}

const isRoundIndex = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < MAX_DAILY_SET_SIZE;

function isAnswerRequest(value: unknown): value is SoloAnswerRequest {
  if (!value || typeof value !== 'object') return false;
  const body = value as Record<string, unknown>;
  return isRoundIndex(body.roundIndex)
    && isRoundInput({
      questionId: body.questionId,
      selectedAnswer: body.selectedAnswer,
      responseTimeMs: body.responseTimeMs,
    });
}

function isHammerRequest(value: unknown): value is SoloHammerRequest {
  if (!value || typeof value !== 'object') return false;
  const body = value as Record<string, unknown>;
  return isRoundIndex(body.roundIndex)
    && typeof body.questionId === 'string' && body.questionId.length > 0 && body.questionId.length <= 128
    && typeof body.skillDistance === 'number' && Number.isFinite(body.skillDistance)
    && body.skillDistance >= 0 && body.skillDistance <= 1;
}

interface LoadedSoloRun {
  run: RunRow;
  questions: Question[];
  practice: boolean;
  friend: boolean;
}

/** Забег должен принадлежать игроку, быть соло (обычным, тренировкой или дружеским) и текущей версии игры. */
async function openSoloRun(c: AppContext, identity: RequestIdentity, runId: string): Promise<LoadedSoloRun | Response> {
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
  return { run, questions, practice, friend };
}

/**
 * Закрывает ожидающий удара круг. Награду считает shared (scoreSubmittedRound → scoreHammerDistance),
 * закрытие защищено условным UPDATE: проигравший гонку запрос просто перечитывает записанное.
 */
async function settleHammerRow(
  c: AppContext,
  run: RunRow,
  questions: Question[],
  rows: SoloRoundRow[],
  index: number,
  skillDistance: number,
): Promise<SoloRoundRow[] | Response> {
  const question = questions[index];
  const row = rows[index];
  const before = rows.slice(0, index);
  if (!question || question.id !== row.question_id || before.some((earlier) => earlier.settled_at === null)) {
    return c.json({ error: 'Stored run is inconsistent.' }, 409);
  }
  const previousResults = before.flatMap((earlier) => (earlier.skill_result ? [earlier.skill_result] : []));
  const scored = scoreSubmittedRound(
    question,
    {
      questionId: question.id,
      selectedAnswer: row.selected_answer,
      responseTimeMs: row.response_time_ms,
      skillDistance,
    },
    previousResults,
  );
  const next = applySoloRound(evaluateSoloRun(questionIds(questions), settledRounds(before)), {
    expectedQuestionId: question.id,
    round: { questionId: question.id, progressAwarded: scored.progressAwarded },
  });
  await settleSoloHammer(c.env.DB, {
    runId: run.id,
    roundIndex: index,
    skillDistance,
    skillResult: scored.skillResult ?? 'miss',
    progressAwarded: scored.progressAwarded,
    progressAfter: next.progress,
    now: Date.now(),
  });
  return listSoloRounds(c.env.DB, run.id);
}

/** Ответ по записанному кругу; если он закрыл забег, забег закрывается (идемпотентно) и итог прикладывается. */
async function respondWithRound(
  c: AppContext,
  loaded: LoadedSoloRun,
  rows: SoloRoundRow[],
  index: number,
): Promise<Response> {
  const { run, questions } = loaded;
  const row = rows[index];
  const question = questions[index];
  const state = evaluateSoloRun(questionIds(questions), settledRounds(rows.slice(0, index + 1)));
  let result: CompleteSoloRunResponse | null = null;
  if (state.status === 'completed' && index === rows.length - 1) {
    const finished = await finalizeSoloRun(c, loaded, rows);
    if (finished instanceof Response) return finished;
    result = finished;
  }
  const settled = row.settled_at !== null;
  const response: SoloRoundResponse = {
    runId: run.id,
    roundIndex: index,
    questionId: question.id,
    correct: row.correct === 1,
    ...(question.answerType === 'open_answer'
      ? { correctAnswers: question.correctAnswers ?? [] }
      : { correctOptionId: question.correctOptionId }),
    explanation: question.explanation,
    awaitingHammer: !settled,
    skillResult: row.skill_result,
    progressAwarded: settled ? row.progress_awarded ?? 0 : 0,
    progress: state.progress,
    roundsPlayed: state.roundsPlayed,
    status: state.status,
    reachedTarget: state.reachedTarget,
    result,
  };
  return c.json(response);
}

/**
 * Закрытие забега сервером: цель, потолок кругов или конец набора (правила: evaluateSoloRun).
 * Идемпотентно: условный UPDATE выполняется ровно одним запросом, остальные получают сохранённый итог.
 */
async function finalizeSoloRun(
  c: AppContext,
  loaded: LoadedSoloRun,
  rows: SoloRoundRow[],
): Promise<CompleteSoloRunResponse | Response> {
  const { run, questions, practice, friend } = loaded;
  const runId = run.id;
  const stored = async (): Promise<CompleteSoloRunResponse | null> => {
    const fresh = await findRun(c.env.DB, runId);
    if (fresh?.status !== 'completed' || !fresh.rounds_json) return null;
    return summary(
      runId,
      questions,
      JSON.parse(fresh.rounds_json) as AsyncMatchRound[],
      fresh.correct_count,
      await findSoloOutcome(c.env.DB, runId),
    );
  };
  if (run.status === 'completed') {
    return (await stored()) ?? c.json({ error: 'Stored run result is missing.' }, 409);
  }

  const rounds = storedRounds(rows);
  const correctCount = rows.filter((row) => row.correct === 1).length;
  const result = summary(runId, questions, rounds, correctCount, null);

  // Сравнение с записью-темпом. Нет записи: исход null, забег ждёт соперника.
  // Тренировка не сравнивается: бот не запись игрока, а исход тренировки не хранится.
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
    return (await stored()) ?? c.json({ error: 'Run completion conflicted with another request.' }, 409);
  }
  // Владелец записи узнаёт исход в любом случае; повтор сюда не доходит (didComplete только у одного запроса).
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
  return result;
}

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
