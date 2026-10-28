import type { WikiPathBoardResponse, WikiPathBoardRouteResponse, WikiPathClickRequest, WikiPathClickResponse, WikiPathTodayResponse, StartWikiPathResponse } from '@clutch/shared';
import { apiFetch, WIKI_PATH_REQUEST_TIMEOUT_MS } from './apiClient';

// ---- «Вики-путь» ----

/** Состояние сегодняшнего общего маршрута и личный прогресс. */
export function fetchWikiPathToday(signal?: AbortSignal): Promise<WikiPathTodayResponse> {
  return apiFetch('/api/wiki-path/today', { method: 'GET' }, signal);
}
/** Начать маршрут или продолжить незавершённый; сервер возвращает текущую статью. */
export function startWikiPath(signal?: AbortSignal): Promise<StartWikiPathResponse> {
  return apiFetch('/api/wiki-path/start', { method: 'POST', body: '{}' }, signal, WIKI_PATH_REQUEST_TIMEOUT_MS);
}

/** Переход проверяет сервер по списку ссылок текущей статьи. */
export function clickWikiPath(
  runId: string,
  body: WikiPathClickRequest,
  signal?: AbortSignal,
): Promise<WikiPathClickResponse> {
  return apiFetch(`/api/wiki-path/runs/${encodeURIComponent(runId)}/click`, {
    method: 'POST', body: JSON.stringify(body),
  }, signal, WIKI_PATH_REQUEST_TIMEOUT_MS);
}

/** Таблица завершивших сегодняшний маршрут. */
export function fetchWikiPathBoard(signal?: AbortSignal): Promise<WikiPathBoardResponse> {
  return apiFetch('/api/wiki-path/board', { method: 'GET' }, signal);
}

/** Цепочка статей завершённого результата из таблицы дня. */
export function fetchWikiPathBoardRoute(runId: string, signal?: AbortSignal): Promise<WikiPathBoardRouteResponse> {
  return apiFetch(`/api/wiki-path/board/runs/${encodeURIComponent(runId)}`, { method: 'GET' }, signal);
}
