import { ApiError, isTransientApiError } from './api';

/** Паузы между повторами одного круга: обрыв связи не должен стоить игроку прогресса. */
export const ROUND_RETRY_DELAYS_MS: readonly number[] = [400, 1_000, 2_500, 5_000, 8_000];
const MAX_RETRY_AFTER_MS = 30_000;

export type DeliveryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown; /** true — повтор имеет смысл (сеть, 5xx, 429), но попытки кончились. */ transient: boolean };

interface DeliveryOptions {
  signal: AbortSignal;
  delaysMs?: readonly number[];
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

/**
 * Отправляет круг и повторяет при временной ошибке. Повтор безопасен: сервер каждый круг считает один раз
 * и на дубликат отвечает уже записанным итогом. Постоянная ошибка (4xx) не повторяется.
 */
export async function deliverRound<T>(
  send: (signal: AbortSignal) => Promise<T>,
  { signal, delaysMs = ROUND_RETRY_DELAYS_MS, sleep = sleepUnlessAborted }: DeliveryOptions,
): Promise<DeliveryResult<T>> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return { ok: true, value: await send(signal) };
    } catch (error) {
      if (signal.aborted) return { ok: false, error, transient: true };
      const transient = isTransientApiError(error);
      if (!transient || attempt >= delaysMs.length) return { ok: false, error, transient };
      const retryAfter = error instanceof ApiError ? error.retryAfterMs : undefined;
      await sleep(Math.min(Math.max(delaysMs[attempt], retryAfter ?? 0), MAX_RETRY_AFTER_MS), signal);
      if (signal.aborted) return { ok: false, error, transient: true };
    }
  }
}
