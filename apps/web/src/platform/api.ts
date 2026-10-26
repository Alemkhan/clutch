import type {
  AnalyticsEventName,
  AnalyticsEventPayload,
  CategoryId,
  CompleteSoloRunResponse,
  CreateFriendInviteResponse,
  CreateRematchInviteResponse,
  DuelBoardResponse,
  PreparedShareResponse,
  GuestSessionResponse,
  PracticeLevelId,
  MyRunsResponse,
  QuestionReportRequest,
  SoloAnswerRequest,
  SoloHammerRequest,
  SoloLeaderboardResponse,
  SoloProfileResponse,
  SoloRoundResponse,
  SoloRunSnapshot,
  StartSoloRunRequest,
  StartSoloRunResponse,
  TrainingCheckRequest,
  TrainingCheckResponse,
  TrainingMistakesResponse,
  TrainingQuestionsRequest,
  TiebreakerAnswerRequest,
  TiebreakerTodayResponse,
  TrainingQuestionsResponse,
  WikiPathBoardResponse,
  WikiPathBoardRouteResponse,
  WikiPathClickRequest,
  WikiPathClickResponse,
  WikiPathTodayResponse,
  StartWikiPathResponse,
} from '@clutch/shared';
import { ANALYTIC_EVENT_NAMES } from '@clutch/shared';
import { getTelegramIdentity } from './telegram';

// Dev and tunnel traffic must reach the local Worker through Vite's /api proxy. Otherwise a
// production VITE_API_URL left in apps/web/.env validates Telegram initData with another bot.
const API_BASE = import.meta.env.DEV ? '' : import.meta.env.VITE_API_URL ?? '';
const DISPLAY_NAME_SEED_KEY = 'clutch_display_name_seed_v1';
const PLAYER_NAME_KEY = 'clutch_player_name_v1';
const GUEST_SESSION_KEY = 'clutch_guest_session_v1';
const SESSION_REFRESH_WINDOW_MS = 5 * 60 * 1000;
const WIKI_PATH_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;

let memoryGuestSession: GuestSessionResponse | null = null;
let guestSessionRequest: Promise<GuestSessionResponse> | null = null;

/**
 * Только в dev: бесплатный ngrok отвечает на запросы заглушкой-предупреждением вместо самого
 * ответа, и этот заголовок — её официальный обход. Нужен, пока игру смотрят через туннель:
 * в проде заголовок не уходит, чтобы не тащить в релиз имя чужого сервиса.
 *
 * Первую загрузку страницы он не спасает: внутри Telegram WebView заголовки навигации задать
 * нечем. Там заглушку снимает только туннель без неё (Cloudflare Tunnel) или платный ngrok.
 */
const TUNNEL_HEADERS: Record<string, string> = import.meta.env.DEV
  ? { 'ngrok-skip-browser-warning': '1' }
  : {};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly retryAfterMs?: number,
    /** Машинный код причины из тела ответа (например, taken/expired/own у приглашений). */
    public readonly reason?: string,
    /** Тело ответа с ошибкой, если оно JSON-объект (у 409 «На глазок» там сохранённое состояние). */
    public readonly body?: unknown,
  ) {
    super(`Clutch API returned ${status}`);
    this.name = 'ApiError';
  }
}

export function isTransientApiError(error: unknown): boolean {
  return !(error instanceof ApiError)
    || error.status === 408
    || error.status === 425
    || error.status === 429
    || error.status >= 500;
}

function getOrCreateDisplayNameSeed(): string {
  try {
    const stored = localStorage.getItem(DISPLAY_NAME_SEED_KEY);
    if (stored) return stored;
    const created = crypto.randomUUID();
    localStorage.setItem(DISPLAY_NAME_SEED_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

function getPlayerName(): string {
  try {
    return localStorage.getItem(PLAYER_NAME_KEY)?.trim()
      || `Игрок ${getOrCreateDisplayNameSeed().slice(0, 4)}`;
  } catch {
    return 'Игрок';
  }
}

async function errorDetails(response: Response): Promise<{ reason?: string; body?: unknown }> {
  try {
    const body = await response.json() as { reason?: unknown } | null;
    return {
      reason: typeof body?.reason === 'string' ? body.reason : undefined,
      body: body && typeof body === 'object' ? body : undefined,
    };
  } catch {
    return {};
  }
}

async function rawApiFetch<T>(path: string, init: RequestInit, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const callerSignal = init.signal;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...TUNNEL_HEADERS, ...init.headers },
      signal: controller.signal,
    });
    if (!response.ok) {
      const retryAfterSeconds = Number(response.headers.get('Retry-After'));
      const details = await errorDetails(response);
      throw new ApiError(
        response.status,
        Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? retryAfterSeconds * 1000
          : undefined,
        details.reason,
        details.body,
      );
    }
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener('abort', abortFromCaller);
  }
}

export function isGuestSessionUsable(
  value: unknown,
  nowMs = Date.now(),
): value is GuestSessionResponse {
  return isGuestSessionShape(value)
    && value.expiresAt > nowMs + SESSION_REFRESH_WINDOW_MS;
}

export function isGuestSessionShape(value: unknown): value is GuestSessionResponse {
  if (!value || typeof value !== 'object') return false;
  const session = value as Record<string, unknown>;
  return typeof session.token === 'string'
    && session.token.length > 0
    && typeof session.expiresAt === 'number'
    && Number.isSafeInteger(session.expiresAt);
}

export function guestRenewalAuthorization(value: unknown, nowMs = Date.now()): string | null {
  return isGuestSessionShape(value) && value.expiresAt > nowMs
    ? `Bearer ${value.token}`
    : null;
}

function readGuestSession(): GuestSessionResponse | null {
  const memorySession = isGuestSessionShape(memoryGuestSession) ? memoryGuestSession : null;
  if (memorySession && memorySession.expiresAt > Date.now()) return memorySession;
  try {
    const stored = localStorage.getItem(GUEST_SESSION_KEY);
    if (!stored) return memorySession;
    const parsed: unknown = JSON.parse(stored);
    if (!isGuestSessionShape(parsed)) return null;
    memoryGuestSession = parsed;
    return parsed;
  } catch {
    return memorySession;
  }
}

function persistGuestSession(session: GuestSessionResponse): void {
  memoryGuestSession = session;
  try {
    localStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(session));
  } catch {
    // Private browsing may disable storage; the in-memory session remains usable.
  }
}

async function getGuestSession(): Promise<GuestSessionResponse> {
  const stored = readGuestSession();
  if (isGuestSessionUsable(stored)) return stored;
  if (!guestSessionRequest) {
    const renewalAuthorization = guestRenewalAuthorization(stored);
    guestSessionRequest = rawApiFetch<GuestSessionResponse>('/api/auth/guest', {
      method: 'POST',
      ...(renewalAuthorization ? { headers: { Authorization: renewalAuthorization } } : {}),
    }).then((session) => {
      if (!isGuestSessionUsable(session)) throw new Error('Clutch API returned an invalid guest session');
      persistGuestSession(session);
      return session;
    }).finally(() => {
      guestSessionRequest = null;
    });
  }
  return guestSessionRequest;
}

async function authorizationHeader(): Promise<string> {
  const telegram = getTelegramIdentity();
  if (telegram?.initData) return `tma ${telegram.initData}`;
  return `Bearer ${(await getGuestSession()).token}`;
}

async function apiFetch<T>(
  path: string,
  init: RequestInit,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<T> {
  signal?.throwIfAborted();
  const authorization = await authorizationHeader();
  signal?.throwIfAborted();
  return rawApiFetch<T>(path, {
    ...init,
    headers: { ...init.headers, Authorization: authorization },
    signal,
  }, timeoutMs);
}

// ---- Соло-забег и «Мои партии» ----

export function startSoloRun(
  category: CategoryId,
  signal?: AbortSignal,
  rematchInviteId?: string,
  botLevel?: PracticeLevelId,
  mode?: StartSoloRunRequest['mode'],
): Promise<StartSoloRunResponse> {
  const telegram = getTelegramIdentity();
  const body: StartSoloRunRequest = {
    displayName: telegram?.displayName || getPlayerName(),
    category,
    ...(rematchInviteId ? { rematchInviteId } : {}),
    ...(botLevel ? { botLevel } : {}),
    ...(mode && !botLevel && !rematchInviteId ? { mode } : {}),
  };
  return apiFetch('/api/solo-runs', { method: 'POST', body: JSON.stringify(body) }, signal);
}

/** Круг соло-забега, шаг 1: ответ. Повтор безопасен: сервер вернёт уже записанный итог круга. */
export function answerSoloRound(
  runId: string,
  body: SoloAnswerRequest,
  signal?: AbortSignal,
): Promise<SoloRoundResponse> {
  return apiFetch(`/api/solo-runs/${encodeURIComponent(runId)}/answer`, {
    method: 'POST',
    body: JSON.stringify(body),
  }, signal);
}

/** Круг соло-забега, шаг 2: удар молотка. Повтор безопасен так же. */
export function hammerSoloRound(
  runId: string,
  body: SoloHammerRequest,
  signal?: AbortSignal,
): Promise<SoloRoundResponse> {
  return apiFetch(`/api/solo-runs/${encodeURIComponent(runId)}/hammer`, {
    method: 'POST',
    body: JSON.stringify(body),
  }, signal);
}

/** Состояние забега для продолжения после закрытой вкладки. */
export function fetchSoloRunSnapshot(runId: string, signal?: AbortSignal): Promise<SoloRunSnapshot> {
  return apiFetch(`/api/solo-runs/${encodeURIComponent(runId)}`, { method: 'GET' }, signal);
}

/** Отказ от незавершённого забега; сервер сохраняет сыгранные круги и закрывает запись. */
export function abandonSoloRun(runId: string, signal?: AbortSignal): Promise<CompleteSoloRunResponse> {
  return apiFetch(`/api/solo-runs/${encodeURIComponent(runId)}/abandon`, {
    method: 'POST',
    body: '{}',
  }, signal);
}

/** Журнал ошибок ведёт сервер: сколько ошибок можно отработать и id ближайшей сессии. */
export function fetchTrainingMistakes(signal?: AbortSignal): Promise<TrainingMistakesResponse> {
  return apiFetch('/api/training/mistakes', { method: 'GET' }, signal);
}

/** Отработка ошибок: вопросы (без ответов) по id из журнала; чужие и недоступные id сервер отклоняет. */
export function fetchTrainingQuestions(ids: string[], signal?: AbortSignal): Promise<TrainingQuestionsResponse> {
  const body: TrainingQuestionsRequest = { ids };
  return apiFetch('/api/training/questions', { method: 'POST', body: JSON.stringify(body) }, signal);
}

/** Проверка ответа в отработке. Для вопроса с вариантами answer — текст выбранного варианта. */
export function checkTrainingAnswer(
  questionId: string,
  answer: string,
  signal?: AbortSignal,
): Promise<TrainingCheckResponse> {
  const body: TrainingCheckRequest = { questionId, answer };
  return apiFetch('/api/training/check', { method: 'POST', body: JSON.stringify(body) }, signal);
}

/** before — nextCursor предыдущей страницы; приглашения приходят только с первой. */
export function fetchMyRuns(
  options: { limit?: number; before?: string } = {},
  signal?: AbortSignal,
): Promise<MyRunsResponse> {
  const query = new URLSearchParams();
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  if (options.before) query.set('before', options.before);
  const suffix = query.size > 0 ? `?${query}` : '';
  return apiFetch(`/api/my-runs${suffix}`, { method: 'GET' }, signal);
}

/** Подтверждённая сервером статистика текущего зачётного solo-режима. */
export function fetchSoloProfile(signal?: AbortSignal): Promise<SoloProfileResponse> {
  return apiFetch('/api/profile', { method: 'GET' }, signal);
}

// ---- Rematch and notifications ----

export interface RematchPreview {
  inviteId: string;
  category: CategoryId;
  /** true: открытая ссылка «Позвать друга», а не реванш по обойдённой записи. */
  friend?: boolean;
  expiresAt: number;
  challengerName: string;
  challengerProgress: number;
  yourProgress: number;
}

export function fetchRematchPreview(inviteId: string, signal?: AbortSignal): Promise<RematchPreview> {
  return apiFetch(`/api/rematch/${encodeURIComponent(inviteId)}`, { method: 'GET' }, signal);
}

/** «Позвать друга»: ссылка на открытое приглашение по своему завершённому забегу; повтор даёт ту же ссылку. */
/** Сообщение-карточка для Telegram shareMessage по ссылке-превью (/api/share/run|guess). */
export function prepareShareMessage(url: string, signal?: AbortSignal): Promise<PreparedShareResponse> {
  return apiFetch('/api/share/prepared', { method: 'POST', body: JSON.stringify({ url }) }, signal);
}

export function createFriendInvite(runId: string, signal?: AbortSignal): Promise<CreateFriendInviteResponse> {
  return apiFetch(`/api/solo-runs/${encodeURIComponent(runId)}/invite`, { method: 'POST', body: '{}' }, signal);
}

/** Таблица дня по категории. Сутки выбирает сервер: граница у всех одна, иначе места несравнимы. */
export function fetchSoloLeaderboard(
  category: CategoryId,
  signal?: AbortSignal,
): Promise<SoloLeaderboardResponse> {
  return apiFetch(`/api/solo-leaderboard?category=${encodeURIComponent(category)}`, { method: 'GET' }, signal);
}

/** Таблица дуэлей дня: победы, ничьи и поражения каждого (по всем категориям). */
export function fetchDuelBoard(signal?: AbortSignal): Promise<DuelBoardResponse> {
  return apiFetch('/api/duel-board', { method: 'GET' }, signal);
}

/** «Позвать на реванш» с обошедшего запись забега: приглашение создаёт это нажатие и только оно. */
export function createRematchInvite(runId: string, signal?: AbortSignal): Promise<CreateRematchInviteResponse> {
  return apiFetch(`/api/solo-runs/${encodeURIComponent(runId)}/rematch`, { method: 'POST', body: '{}' }, signal);
}

export function setOutbidNotifications(enabled: boolean): Promise<{ enabled: boolean }> {
  return apiFetch('/api/notifications/outbid', { method: 'PUT', body: JSON.stringify({ enabled }) });
}

export function fetchDailyNotifications(signal?: AbortSignal): Promise<{ enabled: boolean }> {
  return apiFetch('/api/notifications/daily', { method: 'GET' }, signal);
}

export function setDailyNotifications(enabled: boolean): Promise<{ enabled: boolean }> {
  return apiFetch('/api/notifications/daily', { method: 'PUT', body: JSON.stringify({ enabled }) });
}

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

// ---- Last Stand ----

export function startLastStand(signal?: AbortSignal): Promise<unknown> {
  return apiFetch('/api/last-stand/start', { method: 'POST', body: JSON.stringify({}) }, signal);
}

export function answerLastStand(
  runId: string,
  body: { answer: string; atMs: number },
  signal?: AbortSignal,
): Promise<unknown> {
  return apiFetch(`/api/last-stand/${encodeURIComponent(runId)}/answer`, {
    method: 'POST',
    body: JSON.stringify(body),
  }, signal);
}

export function fetchLastStandLeaderboard(dateKey?: string, signal?: AbortSignal): Promise<unknown> {
  const query = dateKey ? `?date=${encodeURIComponent(dateKey)}` : '';
  return apiFetch(`/api/last-stand/leaderboard${query}`, { method: 'GET' }, signal);
}
