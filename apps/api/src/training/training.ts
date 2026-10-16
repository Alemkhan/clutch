import {
  resolveQuestionById,
  isAnswerCorrect,
  toPublicQuestion,
  type PublicQuestion,
  type Question,
  type TrainingCheckRequest,
  type TrainingCheckResponse,
  type TrainingMistakesResponse,
  type TrainingQuestionsResponse,
} from '@clutch/shared';
import type { Context, Hono } from 'hono';
import { resolveRequestIdentity, type RequestIdentity } from '../auth/identity';
import type { Env } from '../env';
import { readJsonBody } from '../http/jsonBody';
import { checkRateLimit, RATE_LIMIT_PERIOD_SECONDS } from '../http/rateLimit';
import { listTrainableMistakes, payBackMistake, TRAINING_SESSION_SIZE } from './mistakesRepository';

type AppContext = Context<{ Bindings: Env }>;

/** Сколько вопросов за запрос: сессия отработки ошибок — TRAINING_SESSION_SIZE (10), запас на устаревшие id. */
export const TRAINING_MAX_IDS = 20;
const MAX_ID_LENGTH = 64;

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

function correctText(question: Question): string | undefined {
  return question.options.find((option) => option.id === question.correctOptionId)?.text;
}

/** Один и тот же отказ для «такого вопроса нет» и «ты в нём не ошибался»: по различию ответов id не перебрать. */
function notAvailable(c: AppContext): Response {
  return c.json({ error: 'Question not available.' }, 404);
}

/**
 * Отработка ошибок. Вопросы и проверка ответа доступны ТОЛЬКО по ошибкам из серверного журнала игрока
 * (player_mistakes, пишется при неверном круге соло) и только вне непройденной части его активного забега.
 * Варианты каждый раз собираются заново, поэтому для вариантов клиент присылает ТЕКСТ выбранного, а не букву.
 */
export function registerTrainingRoutes(app: Hono<{ Bindings: Env }>): void {
  // Сессия отработки: id по приоритету и общее число доступных ошибок.
  app.get('/api/training/mistakes', async (c) => {
    const identity = await authenticate(c, 'training');
    if (identity instanceof Response) return identity;
    const trainable = await listTrainableMistakes(c.env.DB, identity.playerId);
    const response: TrainingMistakesResponse = {
      count: trainable.length,
      ids: trainable.slice(0, TRAINING_SESSION_SIZE),
    };
    return c.json(response);
  });

  app.post('/api/training/questions', async (c) => {
    const identity = await authenticate(c, 'training');
    if (identity instanceof Response) return identity;
    const parsed = await readJsonBody(c.req.raw, 2048);
    if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
    const ids = (parsed.value as { ids?: unknown } | null)?.ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > TRAINING_MAX_IDS
      || !ids.every((id) => typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LENGTH)) {
      return c.json({ error: 'Invalid ids.' }, 400);
    }
    const allowed = new Set(await listTrainableMistakes(c.env.DB, identity.playerId));
    const questions: PublicQuestion[] = [];
    for (const id of new Set(ids as string[])) {
      const question = allowed.has(id) ? resolveQuestionById(id) : null;
      // Любой недоступный id отклоняет весь запрос одинаково: клиент берёт id из /api/training/mistakes.
      if (!question) return notAvailable(c);
      questions.push(toPublicQuestion(question));
    }
    const response: TrainingQuestionsResponse = { questions };
    return c.json(response);
  });

  app.post('/api/training/check', async (c) => {
    const identity = await authenticate(c, 'training');
    if (identity instanceof Response) return identity;
    const parsed = await readJsonBody(c.req.raw, 1024);
    if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
    const body = parsed.value as Partial<TrainingCheckRequest> | null;
    if (!body || typeof body.questionId !== 'string' || body.questionId.length === 0
      || body.questionId.length > MAX_ID_LENGTH
      || typeof body.answer !== 'string' || body.answer.length > 512) {
      return c.json({ error: 'Invalid answer.' }, 400);
    }
    const allowed = await listTrainableMistakes(c.env.DB, identity.playerId);
    const question = allowed.includes(body.questionId) ? resolveQuestionById(body.questionId) : null;
    if (!question) return notAvailable(c);
    const response: TrainingCheckResponse = question.answerType === 'open_answer'
      ? {
        correct: isAnswerCorrect(body.answer, question.correctAnswers ?? []).correct,
        correctAnswers: question.correctAnswers ?? [],
        explanation: question.explanation,
      }
      : {
        correct: body.answer === correctText(question),
        correctText: correctText(question),
        explanation: question.explanation,
      };
    // Верный ответ гасит один долг в журнале; решённая ошибка уходит из доступных.
    if (response.correct) await payBackMistake(c.env.DB, identity.playerId, question.id, Date.now());
    return c.json(response);
  });
}
