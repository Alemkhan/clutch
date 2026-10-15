import type { TiebreakerAnswerRequest, TiebreakerTodayResponse } from '@clutch/shared';
import { ApiError, isTransientApiError } from './api';

/** Итог отправки ответа. Все ветки, кроме `network` и `rejected`, ведут на вскрытие или обновление карточки. */
export type TiebreakerSubmitOutcome =
  | { kind: 'answered'; state: TiebreakerTodayResponse }
  /** 409 already_answered: ответ уже был (другая вкладка, повтор после обрыва) — показываем сохранённый. */
  | { kind: 'already_answered'; state: TiebreakerTodayResponse | null }
  /** 409 not_todays_question: сутки сменились, карточку надо перечитать. */
  | { kind: 'stale' }
  /** Сеть/5xx/429: ввод цел, можно повторить; сервер повтор не засчитает дважды. */
  | { kind: 'network' }
  /** Сервер отказал в самом ответе (400): повтор того же не поможет. */
  | { kind: 'rejected' };

export function isTiebreakerState(value: unknown): value is TiebreakerTodayResponse {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<TiebreakerTodayResponse>;
  return typeof state.dateKey === 'string'
    && !!state.question && typeof state.question === 'object'
    && !!state.answered && typeof state.answered === 'object'
    && Array.isArray(state.answered.distribution);
}

export interface TiebreakerSubmitDeps {
  answer: (body: TiebreakerAnswerRequest) => Promise<TiebreakerTodayResponse>;
}

/**
 * Один ответ — одна отправка: пока запрос в пути, повторный вызов (двойной тап, Enter) ничего не шлёт.
 * Состояние «в пути» живёт здесь, а не в React: setState не успевает между двумя быстрыми тапами.
 */
export class TiebreakerSubmitter {
  private inFlight = false;

  constructor(private readonly deps: TiebreakerSubmitDeps) {}

  get busy(): boolean {
    return this.inFlight;
  }

  /** null — вызов проигнорирован, потому что предыдущая отправка ещё идёт. */
  async submit(body: TiebreakerAnswerRequest): Promise<TiebreakerSubmitOutcome | null> {
    if (this.inFlight) return null;
    this.inFlight = true;
    try {
      return { kind: 'answered', state: await this.deps.answer(body) };
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        if (error.reason === 'already_answered') {
          return { kind: 'already_answered', state: isTiebreakerState(error.body) ? error.body : null };
        }
        if (error.reason === 'not_todays_question') return { kind: 'stale' };
      }
      return isTransientApiError(error) ? { kind: 'network' } : { kind: 'rejected' };
    } finally {
      this.inFlight = false;
    }
  }
}
