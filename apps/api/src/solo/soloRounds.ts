import {
  CURRENT_HAMMER_MINI_GAME,
  MAX_DAILY_SET_SIZE,
  MAX_HAMMER_ELAPSED_MS,
  applySoloRound,
  evaluateSoloRun,
  scoreHammerTap,
  type CompleteSoloRunResponse,
  type Question,
  type SoloAnswerRequest,
  type SoloHammerRequest,
  type SoloRoundResponse,
} from '@clutch/shared';
import type { RequestIdentity } from '../auth/identity';
import { readJsonBody } from '../http/jsonBody';
import { recordMistake } from '../training/mistakesRepository';
import { finalizeSoloRun } from './finalizeSoloRun';
import { insertSoloAnswer, listSoloRounds, settleSoloHammer, type SoloRoundRow } from './soloRoundsRepository';
import {
  authenticate,
  runIdParam,
  openSoloRun,
  questionIds,
  settledRounds,
  type AppContext,
  type LoadedSoloRun,
} from './soloShared';
import type { RunRow } from './types';
import { correctFor, isRoundInput } from './validation';
import { answerOptionMismatch, answerReplayConflict, hasValidAnswerDiagnostics, reportAnswerDiagnostic } from './answerDiagnostics';

/**
 * Чем закрывается круг: настоящим ударом игрока или отказом от него.
 * `forfeit` — верный ответ без удара (игрок ушёл с забега): промах без присланного времени.
 */
export type HammerSettlement = { kind: 'tap'; activeElapsedMs: number } | { kind: 'forfeit' };

/**
 * Запас к измеренному сервером окну. Активное время клиента всегда меньше настоящего: он
 * обрезает длинные кадры и встаёт на скрытой вкладке. Запас закрывает разницу часов и задержку
 * запроса, то есть это проверка на невозможное время, а не защита от подобранного момента удара:
 * маркер периодичен, и удачная фаза повторяется каждые 1,2–3,3 секунды.
 */
const HAMMER_TIMING_SLACK_MS = 5_000;

/**
 * Запас к измеренному сервером окну ответа. Закрывает разницу часов и задержку запроса. Это
 * проверка на невозможное заявленное время, а не лимит 15 секунд: лимит так не поставить, пока
 * набор уходит клиенту целиком, — вопрос можно прочитать заранее и ответить, когда удобно.
 */
const ANSWER_WINDOW_SLACK_MS = 5_000;

const isRoundIndex = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < MAX_DAILY_SET_SIZE;

function isAnswerRequest(value: unknown): value is SoloAnswerRequest {
  if (!value || typeof value !== 'object') return false;
  const body = value as Record<string, unknown>;
  return isRoundIndex(body.roundIndex)
    && hasValidAnswerDiagnostics(body)
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
    && typeof body.activeElapsedMs === 'number' && Number.isFinite(body.activeElapsedMs)
    && body.activeElapsedMs >= 0 && body.activeElapsedMs <= MAX_HAMMER_ELAPSED_MS;
}

// Круг соло-забега, шаг 1: ответ. Сервер проверяет его и возвращает верность и правильный ответ.
// Неверный ответ закрывает круг с нулём; верный ждёт удар (шаг 2). Повтор отдаёт уже записанное.
export async function handleSoloAnswer(c: AppContext): Promise<Response> {
  const identity = await authenticate(c, 'solo-round');
  if (identity instanceof Response) return identity;
  const parsed = await readJsonBody(c.req.raw, 1024);
  if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
  if (!isAnswerRequest(parsed.value)) return c.json({ error: 'Invalid answer.' }, 400);
  const body = parsed.value;

  const loaded = await openSoloRun(c, identity, runIdParam(c));
  if (loaded instanceof Response) return loaded;
  const { run, questions } = loaded;
  const rows = await listSoloRounds(c.env.DB, run.id);

  if (body.roundIndex < rows.length) {
    if (rows[body.roundIndex].question_id !== body.questionId) {
      return c.json({ error: 'Unexpected question for this round.' }, 400);
    }
    const conflict = answerReplayConflict(rows[body.roundIndex], body, Date.now());
    if (conflict) await reportAnswerDiagnostic(c.env.DB, 'answer_replay_conflict', identity.playerId, run.id, body.questionId, conflict);
    return respondWithRound(c, loaded, rows, body.roundIndex);
  }
  if (body.roundIndex > rows.length) {
    return c.json({ error: 'Rounds must be sent in order.', reason: 'out_of_order' }, 409);
  }
  if (rows.some((row) => row.settled_at === null)) {
    return c.json({ error: 'The previous round is waiting for its hammer.', reason: 'hammer_pending' }, 409);
  }
  const prior = evaluateSoloRun(questionIds(questions), settledRounds(rows), loaded.roundCap);
  if (run.status === 'completed' || prior.status === 'completed') {
    return c.json({ error: 'The run is already finished.', reason: 'completed' }, 409);
  }
  const question = questions[body.roundIndex];
  if (!question || question.id !== body.questionId) {
    return c.json({ error: 'Unexpected question for this round.' }, 400);
  }
  return recordAnswer(c, identity, loaded, rows, question, prior, body);
}

/** Записывает ответ нового круга (окно времени, верность, ошибка в журнал) и отдаёт состояние круга. */
async function recordAnswer(
  c: AppContext,
  identity: RequestIdentity,
  loaded: LoadedSoloRun,
  rows: SoloRoundRow[],
  question: Question,
  prior: ReturnType<typeof evaluateSoloRun>,
  body: SoloAnswerRequest,
): Promise<Response> {
  const { run } = loaded;
  // Окно ответа по часам сервера: от закрытия предыдущего круга (у первого — от старта забега)
  // до этого запроса. Это верхняя граница времени на вопрос: внутрь входят разбор и удар
  // предыдущего круга, а у продолженного забега — и всё время, пока вкладка была закрыта.
  const answeredAt = Date.now();
  const previous = rows[body.roundIndex - 1];
  const answerWindowMs = Math.max(0, answeredAt - (previous?.settled_at ?? run.created_at));
  // Заявить время больше окна невозможно: столько вопрос не был открыт.
  if (body.responseTimeMs > answerWindowMs + ANSWER_WINDOW_SLACK_MS) {
    return c.json({ error: 'Response time is impossible for this round.', reason: 'impossible_timing' }, 400);
  }

  const correct = correctFor(question, body.selectedAnswer);
  const settledProgressAfter = correct
    ? null
    : applySoloRound(prior, {
      expectedQuestionId: question.id,
      round: { questionId: question.id, progressAwarded: 0 },
    }, loaded.roundCap).progress;
  // Если параллельный запрос успел раньше, вставка ничего не изменит и ниже вернётся записанное им.
  const inserted = await insertSoloAnswer(c.env.DB, {
    runId: run.id,
    roundIndex: body.roundIndex,
    questionId: question.id,
    selectedAnswer: body.selectedAnswer,
    responseTimeMs: Math.min(body.responseTimeMs, 60_000),
    correct,
    settledProgressAfter,
    answerWindowMs,
    now: answeredAt,
  });
  // Ошибка пишется в журнал игрока ровно один раз: повтор запроса вставку не проходит (inserted = false).
  // Пишем и тренировочные, и дружеские забеги: сервер всё равно показал игроку верный ответ.
  const mismatch = inserted ? answerOptionMismatch(question, body) : null;
  if (mismatch) await reportAnswerDiagnostic(c.env.DB, 'answer_option_mismatch', identity.playerId, run.id, question.id, mismatch);
  if (inserted && !correct) await recordMistake(c.env.DB, identity.playerId, question.id, Date.now());
  return respondWithRound(c, loaded, await listSoloRounds(c.env.DB, run.id), body.roundIndex);
}

// Круг соло-забега, шаг 2: удар по верному ответу. Клиент сообщает момент удара, расстояние до
// цели и награду считает сервер: цель и скорость маркера он выводит из id вопроса и стадии сам.
export async function handleSoloHammer(c: AppContext): Promise<Response> {
  const identity = await authenticate(c, 'solo-round');
  if (identity instanceof Response) return identity;
  const parsed = await readJsonBody(c.req.raw, 1024);
  if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
  if (!isHammerRequest(parsed.value)) return c.json({ error: 'Invalid hammer result.' }, 400);
  const body = parsed.value;

  const loaded = await openSoloRun(c, identity, runIdParam(c));
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
    const settled = await settleHammerRow(c, loaded, rows, body.roundIndex, {
      kind: 'tap',
      activeElapsedMs: body.activeElapsedMs,
    });
    if (settled instanceof Response) return settled;
    rows = settled;
  }
  return respondWithRound(c, loaded, rows, body.roundIndex);
}

/**
 * Закрывает ожидающий удара круг. Расстояние до цели считает сервер из присланного момента удара
 * (`scoreHammerTap`): цель и скорость маркера он выводит из id вопроса и стадии давления сам, так
 * что оценку удара клиент сообщить не может — только время. Закрытие защищено условным UPDATE:
 * проигравший гонку запрос просто перечитывает записанное.
 */
export async function settleHammerRow(
  c: AppContext,
  loaded: LoadedSoloRun,
  rows: SoloRoundRow[],
  index: number,
  settlement: HammerSettlement,
): Promise<SoloRoundRow[] | Response> {
  const { run, questions, roundCap } = loaded;
  const question = questions[index];
  const row = rows[index];
  const before = rows.slice(0, index);
  if (!question || question.id !== row.question_id || before.some((earlier) => earlier.settled_at === null)) {
    return c.json({ error: 'Stored run is inconsistent.' }, 409);
  }
  const now = Date.now();
  if (settlement.kind === 'tap' && settlement.activeElapsedMs > now - row.created_at + HAMMER_TIMING_SLACK_MS) {
    return c.json({ error: 'Hammer timing is impossible for this round.', reason: 'impossible_timing' }, 400);
  }
  const previousResults = before.flatMap((earlier) => (earlier.skill_result ? [earlier.skill_result] : []));
  const scored = settlement.kind === 'tap'
    ? scoreHammerTap(
      question.id,
      previousResults,
      CURRENT_HAMMER_MINI_GAME.config,
      settlement.activeElapsedMs,
    )
    : { distance: 1, result: 'miss' as const, progressAwarded: 0 };
  const next = applySoloRound(evaluateSoloRun(questionIds(questions), settledRounds(before), roundCap), {
    expectedQuestionId: question.id,
    round: { questionId: question.id, progressAwarded: scored.progressAwarded },
  }, roundCap);
  await settleSoloHammer(c.env.DB, {
    runId: run.id,
    roundIndex: index,
    activeElapsedMs: settlement.kind === 'tap' ? settlement.activeElapsedMs : null,
    skillDistance: scored.distance,
    skillResult: scored.result,
    progressAwarded: scored.progressAwarded,
    progressAfter: next.progress,
    now,
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
  const state = evaluateSoloRun(questionIds(questions), settledRounds(rows.slice(0, index + 1)), loaded.roundCap);
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
      : { correctOptionId: question.correctOptionId, selectedAnswer: row.selected_answer }),
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
