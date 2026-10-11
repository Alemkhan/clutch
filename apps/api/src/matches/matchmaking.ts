import {
  dailyQuestionSet,
  dailyQuestionSetIds,
  type Question,
  type StartAsyncMatchRequest,
} from '@clutch/shared';
import { findGhostInSets, lastPlayedBySet, type GhostMatch, type PoolOptions } from './repository';

/**
 * Единый подбор: свободная запись на не сыгранном игроком наборе, иначе не сыгранный набор (бот),
 * иначе любая свободная запись, иначе давнее всего сыгранный набор (бот). Без исключений.
 * `bankExhausted`: игрок прошёл все наборы дня, набор повторяется, и клиент может сказать об этом прямо.
 */
export async function matchmake(
  db: D1Database,
  category: StartAsyncMatchRequest['category'],
  playerId: string,
  now: number,
  pool: PoolOptions = {},
): Promise<{ ghost: GhostMatch | null; questionSetId: string; questions: Question[]; bankExhausted: boolean }> {
  const bankIds = dailyQuestionSetIds(category, now);
  let ghost = await findGhostInSets(db, bankIds, playerId, { ...pool, unplayedSetsOnly: true });
  if (ghost) return { ghost, questionSetId: ghost.questionSetId, questions: ghost.questions, bankExhausted: false };
  const played = await lastPlayedBySet(db, bankIds, playerId);
  let index = bankIds.findIndex((id) => !played.has(id));
  const bankExhausted = index === -1;
  if (bankExhausted) {
    ghost = await findGhostInSets(db, bankIds, playerId, pool);
    if (ghost) return { ghost, questionSetId: ghost.questionSetId, questions: ghost.questions, bankExhausted };
    index = 0;
    for (let candidate = 1; candidate < bankIds.length; candidate++) {
      if (played.get(bankIds[candidate])! < played.get(bankIds[index])!) index = candidate;
    }
  }
  return { ghost: null, ...dailyQuestionSet(category, now, index), bankExhausted };
}
