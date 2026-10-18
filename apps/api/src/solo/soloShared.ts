import {
  FRIEND_RULES_VERSION,
  PRACTICE_RULES_VERSION,
  duelRoundCap,
  isMiniGameId,
  soloModeOf,
  type Opponent,
  type Question,
  type SoloMode,
} from '@clutch/shared';
import type { Context } from 'hono';
import { resolveRequestIdentity, type RequestIdentity } from '../auth/identity';
import type { Env } from '../env';
import { checkRateLimit, RATE_LIMIT_PERIOD_SECONDS } from '../http/rateLimit';
import { currentMiniGameConfigJson, findRun } from './repository';
import type { SoloRoundRow } from './soloRoundsRepository';
import type { RunRow } from './types';
import { parseQuestions } from './validation';

/** Общее для обработчиков соло-забега: контекст запроса, вход, загрузка забега и мелкие преобразования. */
export type AppContext = Context<{ Bindings: Env }>;

/** Работа после ответа через waitUntil; без execution context (тесты) просто запускается. */
export function deferred(c: AppContext, work: Promise<unknown>): void {
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    void work;
  }
}

export async function authenticate(c: AppContext, scope: string): Promise<RequestIdentity | Response> {
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

export const questionIds = (questions: readonly Question[]) => questions.map((question) => question.id);

/** Только закрытые круги: ожидающий удара прогресс не меняет. */
export function settledRounds(rows: readonly SoloRoundRow[]) {
  return rows
    .filter((row) => row.settled_at !== null)
    .map((row) => ({ questionId: row.question_id, progressAwarded: row.progress_awarded ?? 0 }));
}

export function parsePace(value: string | null): Opponent | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as Opponent;
  } catch {
    return null;
  }
}

export interface LoadedSoloRun {
  run: RunRow;
  questions: Question[];
  practice: boolean;
  friend: boolean;
  /** Забег дня, свободная игра или дуэль; null у тренировки и дружеской дуэли. */
  mode: SoloMode | null;
  /**
   * Потолок кругов этого забега. Против записи (дуэль, дружеская дуэль) — круг, на котором запись
   * дошла до цели: дальше игрок уже проиграл. Темп снят (запись ушла другому) — общий потолок.
   */
  roundCap: number;
}

/** Забег должен принадлежать игроку, быть соло (обычным, тренировкой или дружеским) и текущей версии игры. */
export async function openSoloRun(c: AppContext, identity: RequestIdentity, runId: string): Promise<LoadedSoloRun | Response> {
  const run = await findRun(c.env.DB, runId);
  if (!run || run.player_id !== identity.playerId) return c.json({ error: 'Run not found.' }, 404);
  const practice = run.rules_version === PRACTICE_RULES_VERSION;
  const friend = run.rules_version === FRIEND_RULES_VERSION;
  const mode = soloModeOf(run.rules_version);
  if ((!practice && !friend && !mode)
    || run.mini_game_config_json !== currentMiniGameConfigJson
    || !isMiniGameId(run.mini_game_id)) {
    return c.json({ error: 'This is not a solo run.' }, 409);
  }
  const questions = parseQuestions(run.questions_json);
  if (!questions) return c.json({ error: 'Stored run questions are invalid.' }, 409);
  // Тренировка против бота доигрывается до конца: бот не запись игрока, исход не считается.
  const roundCap = duelRoundCap(practice ? null : parsePace(run.opponent_json));
  return { run, questions, practice, friend, mode, roundCap };
}

/** Идентификатор забега из пути маршрута `/api/solo-runs/:id/...`. */
export const runIdParam = (c: AppContext): string => c.req.param('id') ?? '';
