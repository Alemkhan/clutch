import type { TiebreakerAnswerRequest, TiebreakerTodayResponse } from '@clutch/shared';
import { apiFetch } from './apiClient';

// ---- «На глазок» ----

/** Вопрос дня и, если игрок уже ответил, вскрытие. Чужого состояния не кэшируем: читаем с сервера каждый раз. */
export function fetchTiebreakerToday(signal?: AbortSignal): Promise<TiebreakerTodayResponse> {
  return apiFetch('/api/tiebreaker/today', { method: 'GET' }, signal);
}
/** Один ответ на вопрос дня. 409 несёт reason (already_answered с состоянием в body либо not_todays_question). */
export function answerTiebreaker(
  body: TiebreakerAnswerRequest,
  signal?: AbortSignal,
): Promise<TiebreakerTodayResponse> {
  return apiFetch('/api/tiebreaker/answer', { method: 'POST', body: JSON.stringify(body) }, signal);
}
