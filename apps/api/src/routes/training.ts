import {
  generateQuestionById,
  isAnswerCorrect,
  toPublicQuestion,
  type PublicQuestion,
  type Question,
  type TrainingCheckRequest,
  type TrainingCheckResponse,
  type TrainingQuestionsResponse,
} from '@clutch/shared';
import type { Context, Hono } from 'hono';
import { resolveRequestIdentity, type RequestIdentity } from '../auth/identity';
import type { Env } from '../env';
import { readJsonBody } from '../http/jsonBody';
import { checkRateLimit, RATE_LIMIT_PERIOD_SECONDS } from '../http/rateLimit';

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

/**
 * Отработка ошибок без состояния: id вопроса восстанавливает вопрос, варианты каждый раз собираются заново,
 * поэтому для вариантов клиент присылает ТЕКСТ выбранного, а не букву. Без забега и без записи в базу.
 */
export function registerTrainingRoutes(app: Hono<{ Bindings: Env }>): void {
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
    const questions: PublicQuestion[] = [];
    const unknownIds: string[] = [];
    for (const id of new Set(ids as string[])) {
      const question = generateQuestionById(id);
      if (question) questions.push(toPublicQuestion(question));
      else unknownIds.push(id);
    }
    const response: TrainingQuestionsResponse = { questions, unknownIds };
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
    const question = generateQuestionById(body.questionId);
    if (!question) return c.json({ error: 'Unknown question.' }, 404);
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
    return c.json(response);
  });
}
