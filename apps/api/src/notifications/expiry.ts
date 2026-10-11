import { releaseExpiredInvites } from './repository';

/** Пачка за один проход: не упираемся в лимиты воркера; остаток уйдёт со следующим запуском. */
export const EXPIRY_BATCH_SIZE = 200;

export interface ExpirySummary {
  released: number;
  /** Пачка заполнена целиком: просроченные могли остаться до следующего прохода. */
  more: boolean;
}

/**
 * Отпускает просроченные неиспользованные приглашения. Забег-вызов в общем пуле виден и так
 * (findGhostInSets не смотрит на rematch_invites), поэтому проход только ставит released_at.
 * Время передаётся снаружи, чтобы проход был детерминированным в тестах.
 */
export async function releaseExpiredRematchInvites(
  db: D1Database,
  now: number,
  batchSize: number = EXPIRY_BATCH_SIZE,
): Promise<ExpirySummary> {
  const released = await releaseExpiredInvites(db, now, batchSize);
  return { released, more: released >= batchSize };
}
