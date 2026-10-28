import type { AnalyticsEventName, AnalyticsEventPayload, QuestionReportRequest } from '@clutch/shared';
import { ANALYTIC_EVENT_NAMES } from '@clutch/shared';
import { apiFetch } from './apiClient';

// ---- Репорты и аналитика ----

/** Репорт о проблеме с вопросом с экрана разбора: обычный await-вызов, статус рисует вызывающий. */
export function submitQuestionReport(
  body: QuestionReportRequest,
  signal?: AbortSignal,
): Promise<{ ok: true }> {
  return apiFetch('/api/reports', { method: 'POST', body: JSON.stringify(body) }, signal);
}
/**
 * Минимальная продуктовая аналитика: строго fire-and-forget. Без await, очереди и ретраев;
 * любая ошибка глотается, событие никогда не ломает UI. Имена — общий allowlist с сервером.
 */
export function logAnalyticsEvent(event: AnalyticsEventName, payload?: AnalyticsEventPayload): void {
  if (!ANALYTIC_EVENT_NAMES.includes(event)) return;
  void apiFetch('/api/events', {
    method: 'POST',
    body: JSON.stringify(payload ? { event, payload } : { event }),
  }).catch(() => undefined);
}
