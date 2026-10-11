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
/**
 * Набор дня, которого игрок ещё не видел; если видел все — давнее всего сыгранный.
 * Единственное место, где выбирается набор: тренировка обязана ходить сюда же,
 * иначе выдаст вопросы, уже сыгранные в соревновании.
 */
export async function pickSet(
  db: D1Database,
  category: StartAsyncMatchRequest['category'],
  playerId: string,
  now: number,
): Promise<{ questionSetId: string; questions: Question[]; bankExhausted: boolean }> {
  const bankIds = dailyQuestionSetIds(category, now);
  const played = await lastPlayedBySet(db, bankIds, playerId);
  let index = bankIds.findIndex((id) => !played.has(id));
  const bankExhausted = index === -1;
  if (bankExhausted) {
    index = 0;
    for (let candidate = 1; candidate < bankIds.length; candidate++) {
      if (played.get(bankIds[candidate])! < played.get(bankIds[index])!) index = candidate;
    }
  }
  return { ...dailyQuestionSet(category, now, index), bankExhausted };
}

export async function matchmake(
  db: D1Database,
  category: StartAsyncMatchRequest['category'],
  playerId: string,
  now: number,
  pool: PoolOptions = {},
): Promise<{ ghost: GhostMatch | null; questionSetId: string; questions: Question[]; bankExhausted: boolean }> {
  const bankIds = dailyQuestionSetIds(category, now);
  pool = { now, ...pool };
  let ghost = await findGhostInSets(db, bankIds, playerId, { ...pool, unplayedSetsOnly: true });
  if (ghost) return { ghost, questionSetId: ghost.questionSetId, questions: ghost.questions, bankExhausted: false };
  const picked = await pickSet(db, category, playerId, now);
  if (picked.bankExhausted) {
    ghost = await findGhostInSets(db, bankIds, playerId, pool);
    if (ghost) return { ghost, questionSetId: ghost.questionSetId, questions: ghost.questions, bankExhausted: true };
  }
  return { ghost: null, ...picked };
}
