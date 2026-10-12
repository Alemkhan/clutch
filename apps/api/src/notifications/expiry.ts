import { releaseExpiredClaims } from '../matches/repository';
import { releaseExpiredInvites } from './repository';

/** Пачка за один проход: не упираемся в лимиты воркера; остаток уйдёт со следующим запуском. */
export const EXPIRY_BATCH_SIZE = 200;

export interface ExpirySummary {
  released: number;
  /** Записи, освобождённые от брошенного претендента. */
  claimsReleased: number;
  /** Пачка заполнена целиком: просроченные могли остаться до следующего прохода. */
  more: boolean;
}

/**
 * Отпускает просроченные неиспользованные приглашения: ставит released_at. Резерв записи под открытое
 * приглашение findGhostInSets снимает по expires_at сам, поэтому запись возвращается в общий подбор
 * ровно по сроку, а проход только фиксирует отпускание и делает его идемпотентным.
 * Время передаётся снаружи, чтобы проход был детерминированным в тестах.
 */
export async function releaseExpiredRematchInvites(
  db: D1Database,
  now: number,
  batchSize: number = EXPIRY_BATCH_SIZE,
): Promise<ExpirySummary> {
  const released = await releaseExpiredInvites(db, now, batchSize);
  // Претендент забрал запись и не доиграл: по сроку она возвращается в подбор.
  const claimsReleased = await releaseExpiredClaims(db, now, batchSize);
  return { released, claimsReleased, more: released >= batchSize || claimsReleased >= batchSize };
}
