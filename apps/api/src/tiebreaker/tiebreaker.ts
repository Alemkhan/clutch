import type { Context, Hono } from 'hono';
import {
  dailyKey,
  parseTiebreakerGuess,
  tiebreakerMultiplier,
  type TiebreakerTodayResponse,
} from '@clutch/shared';
import { deferred } from '../solo/soloShared';
import { resolveRequestIdentity, type RequestIdentity } from '../auth/identity';
import type { Env } from '../env';
import { categoriesWithBoardRun, notifyBumpedFromTopTen, snapshotTopTen, type TopTenSnapshot } from '../notifications/outOfTop';
import { readJsonBody } from '../http/jsonBody';
import { checkRateLimit, RATE_LIMIT_PERIOD_SECONDS } from '../http/rateLimit';
import {
  buildAnsweredView,
  countQuestionAnswers,
  findPlayerAnswer,
  findQuestionByDate,
  insertPlayerAnswer,
  type TiebreakerQuestionRow,
} from './tiebreakerRepository';

type AppContext = Context<{ Bindings: Env }>;

const ANSWER_BODY_MAX_BYTES = 512;
const QUESTION_ID_MAX = 128;

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

/** Состояние для клиента: answer/источник/статистика только после собственного ответа игрока; до него — лишь число ответивших. */
async function todayState(
  db: D1Database,
  playerId: string,
  dateKey: string,
  question: TiebreakerQuestionRow,
): Promise<TiebreakerTodayResponse> {
  const own = await findPlayerAnswer(db, playerId, question.id);
  const answered = own ? await buildAnsweredView(db, question, own) : null;
  return {
    dateKey,
    question: {
      id: question.id,
      number: question.number,
      prompt: question.prompt,
      cardPrompt: question.cardPrompt,
      unit: question.unit,
    },
    answered,
    // До своего ответа наружу уходит только число ответивших (решение владельца 2026-10-16).
    answersCount: answered ? answered.totalAnswers : await countQuestionAnswers(db, question.id),
  };
}

/** «На глазок» (R24b): вопрос дня и один ответ-прикидка на игрока. */
export function registerTiebreakerRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/api/tiebreaker/today', async (c) => {
    const identity = await authenticate(c, 'tiebreaker');
    if (identity instanceof Response) return identity;
    const dateKey = dailyKey(Date.now());
    const question = await findQuestionByDate(c.env.DB, dateKey);
    if (!question) return c.json({ dateKey, question: null, answered: null, answersCount: 0 } satisfies TiebreakerTodayResponse);
    return c.json(await todayState(c.env.DB, identity.playerId, dateKey, question));
  });

  app.post('/api/tiebreaker/answer', async (c) => {
    // Отдельный bucket: ответ — запись, и он не должен делить лимит с чтением карточки.
    const identity = await authenticate(c, 'tiebreaker_answer');
    if (identity instanceof Response) return identity;
    const parsed = await readJsonBody(c.req.raw, ANSWER_BODY_MAX_BYTES);
    if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
    if (!parsed.value || typeof parsed.value !== 'object') {
      return c.json({ error: 'Invalid answer.', reason: 'invalid_answer' }, 400);
    }
    const body = parsed.value as Record<string, unknown>;
    if (typeof body.questionId !== 'string' || body.questionId.length === 0 || body.questionId.length > QUESTION_ID_MAX) {
      return c.json({ error: 'Invalid answer.', reason: 'invalid_question' }, 400);
    }
    let guess: number;
    try {
      guess = parseTiebreakerGuess(body.guess);
    } catch {
      return c.json({ error: 'Invalid answer.', reason: 'invalid_guess' }, 400);
    }

    const now = Date.now();
    const dateKey = dailyKey(now);
    const question = await findQuestionByDate(c.env.DB, dateKey);
    // 409, а не 400: тело корректно, но вопрос уже не (или ещё не) текущий — клиенту нужно перечитать
    // карточку. Вчерашний вопрос не принимается: ответ действует на сутки своего вопроса.
    if (!question || question.id !== body.questionId) {
      return c.json({ error: 'This is not the question of the day.', reason: 'not_todays_question' }, 409);
    }

    // R25: ответ может переставить равных. Снимок верха таблицы до записи, только для Telegram:
    // ответ гостя в таблице не учитывается и ничего не сдвигает.
    let scope: { categories: string[]; before: TopTenSnapshot } | null = null;
    if (identity.playerId.startsWith('telegram:')) {
      try {
        const categories = await categoriesWithBoardRun(c.env.DB, identity.playerId, dateKey);
        if (categories.length > 0) scope = { categories, before: await snapshotTopTen(c.env.DB, categories, dateKey) };
      } catch {
        scope = null;
      }
    }

    const inserted = await insertPlayerAnswer(c.env.DB, {
      playerId: identity.playerId,
      questionId: question.id,
      dateKey,
      guess,
      multiplier: tiebreakerMultiplier(guess, question.answer),
      now,
    });
    const state = await todayState(c.env.DB, identity.playerId, dateKey, question);
    if (inserted && scope) {
      const { categories, before } = scope;
      deferred(c, (async () => {
        await notifyBumpedFromTopTen(c.env, {
          triggerPlayerId: identity.playerId,
          triggerName: identity.displayName ?? 'Игрок',
          dateKey,
          before,
          after: await snapshotTopTen(c.env.DB, categories, dateKey),
        });
      })().catch(() => {
        console.error({ event: 'telegram_notification_handler', kind: 'top_ten', reasonCode: 'unexpected_error' });
      }));
    }
    if (!inserted) return c.json({ error: 'Already answered.', reason: 'already_answered', ...state }, 409);
    return c.json(state, 201);
  });
}
