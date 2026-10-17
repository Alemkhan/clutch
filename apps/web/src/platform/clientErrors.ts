import { logAnalyticsEvent } from './api';

/** Не больше стольких client_error за загрузку страницы; одинаковое сообщение шлётся один раз. */
export const CLIENT_ERROR_LIMIT = 5;
const MESSAGE_MAX = 64;

export type ClientErrorKind = 'render' | 'error' | 'rejection';

const seen = new Set<string>();
let currentScreen: string | undefined;

/** Текущий экран для поля screen; необязательно, ошибка без него тоже уходит. */
export function setClientErrorScreen(screen: string | undefined): void {
  currentScreen = screen;
}

/** Всё после «?» (query, токены) вырезается, затем обрезка до 64 символов. */
export function sanitizeErrorMessage(raw: unknown): string {
  let text: string;
  if (raw instanceof Error) text = raw.message || raw.name;
  else if (typeof raw === 'string') text = raw;
  else {
    try {
      text = String(raw);
    } catch {
      text = 'unknown';
    }
  }
  text = text.replace(/\s+/g, ' ').trim();
  // «?» режет и URL, и сообщения с вопросительным знаком: для сводки этого достаточно.
  const cut = text.indexOf('?');
  if (cut !== -1) text = text.slice(0, cut);
  text = text.trim().slice(0, MESSAGE_MAX);
  return text || 'unknown';
}

/**
 * «Script error.» — кросс-доменная ошибка чужого скрипта (Telegram WebView, расширения):
 * браузер скрывает подробности, приложение она не роняет. Шума не шлём; render — всегда.
 */
function isOpaqueScriptError(kind: ClientErrorKind, raw: unknown, message: string): boolean {
  if (kind !== 'error') return false;
  if (raw instanceof Error && raw.stack) return false;
  return message === 'unknown' || message === '' || /^script error\.?$/i.test(message);
}

export function reportClientError(kind: ClientErrorKind, raw: unknown): void {
  try {
    const message = sanitizeErrorMessage(raw);
    if (isOpaqueScriptError(kind, raw, message)) return;
    if (seen.has(message) || seen.size >= CLIENT_ERROR_LIMIT) return;
    seen.add(message);
    const payload: Record<string, string> = { kind, message };
    if (currentScreen) payload.screen = currentScreen.slice(0, 64);
    const build = import.meta.env.VITE_BUILD_ID as string | undefined;
    if (build) payload.build = build.slice(0, 64);
    logAnalyticsEvent('client_error', payload);
  } catch {
    // Отправка отчёта не должна сама ломать приложение.
  }
}

/** Глобальные обработчики; возвращает отписку. */
export function installClientErrorHandlers(target: Window = window): () => void {
  const onError = (event: ErrorEvent) => reportClientError('error', event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) => reportClientError('rejection', event.reason);
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}

/** Только для тестов. */
export function resetClientErrorsForTest(): void {
  seen.clear();
  currentScreen = undefined;
}
