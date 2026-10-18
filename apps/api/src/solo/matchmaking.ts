import {
  DUEL_RULES_VERSION,
  dailyQuestionSet,
  freshQuestionSet,
  type Question,
  type StartAsyncMatchRequest,
} from '@clutch/shared';
import { DUEL_RECORD_TTL_MS, findGhostInSets, type GhostMatch } from './repository';
import { seenQuestionKeys } from './soloRepository';

type Category = StartAsyncMatchRequest['category'];

export interface PickedSet {
  ghost: GhostMatch | null;
  questionSetId: string;
  questions: Question[];
  bankExhausted: boolean;
}

/**
 * Забег дня: один общий набор дня на категорию (первый в банке дня). Все играют одни и те же
 * вопросы, поэтому результаты сравнимы в таблице и при шаринге.
 */
export function dailySet(category: Category, now: number): PickedSet {
  return { ghost: null, ...dailyQuestionSet(category, now, 0), bankExhausted: false };
}

/** Свободная игра: свежий набор без вопросов, которые игрок уже видел. */
export async function freeSet(db: D1Database, category: Category, playerId: string, seed: string, now: number): Promise<PickedSet> {
  const seen = await seenQuestionKeys(db, playerId);
  return { ghost: null, ...freshQuestionSet(category, seed, seen, now), bankExhausted: false };
}

/**
 * Дуэль: свежая запись другого игрока (дошедшая до цели, на наборе, который игрок не начинал),
 * её набор — набор дуэли. Записи нет — свежий набор без соперника: забег сам станет записью и
 * дождётся следующего. Захват записи делает вызывающий (claimRecord).
 */
export async function matchmakeDuel(
  db: D1Database,
  category: Category,
  playerId: string,
  seed: string,
  now: number,
): Promise<PickedSet> {
  const ghost = await findGhostInSets(db, { category, since: now - DUEL_RECORD_TTL_MS }, playerId, {
    now,
    rulesVersion: DUEL_RULES_VERSION,
    reachedTargetOnly: true,
    unplayedSetsOnly: true,
  });
  if (ghost) return { ghost, questionSetId: ghost.questionSetId, questions: ghost.questions, bankExhausted: false };
  return freeSet(db, category, playerId, seed, now);
}
