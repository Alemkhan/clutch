import type {
  CategoryId,
  CompleteAsyncMatchRequest,
  CompleteAsyncMatchResponse,
  CompleteSoloRunRequest,
  CompleteSoloRunResponse,
  GuestSessionResponse,
  MyRunsResponse,
  StartSoloRunRequest,
  StartSoloRunResponse,
  StartAsyncMatchRequest,
  StartAsyncMatchResponse,
} from '@clutch/shared';
import { getTelegramIdentity } from './telegram';

const API_BASE = import.meta.env.VITE_API_URL ?? '';
const DISPLAY_NAME_SEED_KEY = 'clutch_display_name_seed_v1';
const PLAYER_NAME_KEY = 'clutch_player_name_v1';
const GUEST_SESSION_KEY = 'clutch_guest_session_v1';
const SESSION_REFRESH_WINDOW_MS = 5 * 60 * 1000;

let memoryGuestSession: GuestSessionResponse | null = null;
let guestSessionRequest: Promise<GuestSessionResponse> | null = null;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly retryAfterMs?: number,
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

async function rawApiFetch<T>(path: string, init: RequestInit): Promise<T> {
  const controller = new AbortController();
  const callerSignal = init.signal;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init.headers },
      signal: controller.signal,
    });
    if (!response.ok) {
      const retryAfterSeconds = Number(response.headers.get('Retry-After'));
      throw new ApiError(
        response.status,
        Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? retryAfterSeconds * 1000
          : undefined,
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

async function apiFetch<T>(path: string, init: RequestInit, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const authorization = await authorizationHeader();
  signal?.throwIfAborted();
  return rawApiFetch<T>(path, {
    ...init,
    headers: { ...init.headers, Authorization: authorization },
    signal,
  });
}

export function startAsyncMatch(
  category: CategoryId,
  signal?: AbortSignal,
  rematchInviteId?: string,
): Promise<StartAsyncMatchResponse> {
  const telegram = getTelegramIdentity();
  const body: StartAsyncMatchRequest = {
    displayName: telegram?.displayName || getPlayerName(),
    category,
    ...(rematchInviteId ? { rematchInviteId } : {}),
  };
  return apiFetch('/api/async-matches', {
    method: 'POST',
    body: JSON.stringify(body),
  }, signal);
}

export function completeAsyncMatch(
  matchId: string,
  body: CompleteAsyncMatchRequest,
): Promise<CompleteAsyncMatchResponse> {
  return apiFetch(`/api/async-matches/${encodeURIComponent(matchId)}/complete`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ---- Соло-забег и «Мои партии» ----

export function startSoloRun(category: CategoryId, signal?: AbortSignal): Promise<StartSoloRunResponse> {
  const telegram = getTelegramIdentity();
  const body: StartSoloRunRequest = {
    displayName: telegram?.displayName || getPlayerName(),
    category,
  };
  return apiFetch('/api/solo-runs', { method: 'POST', body: JSON.stringify(body) }, signal);
}

export function completeSoloRun(
  runId: string,
  body: CompleteSoloRunRequest,
  signal?: AbortSignal,
): Promise<CompleteSoloRunResponse> {
  return apiFetch(`/api/solo-runs/${encodeURIComponent(runId)}/complete`, {
    method: 'POST',
    body: JSON.stringify(body),
  }, signal);
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

// ---- Rematch and notifications ----

export interface RematchPreview {
  inviteId: string;
  category: CategoryId;
  challengerName: string;
  challengerProgress: number;
  yourProgress: number;
}

export function fetchRematchPreview(inviteId: string, signal?: AbortSignal): Promise<RematchPreview> {
  return apiFetch(`/api/rematch/${encodeURIComponent(inviteId)}`, { method: 'GET' }, signal);
}

export function setOutbidNotifications(enabled: boolean): Promise<{ enabled: boolean }> {
  return apiFetch('/api/notifications/outbid', { method: 'PUT', body: JSON.stringify({ enabled }) });
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
