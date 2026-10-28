import type { GuestSessionResponse } from '@clutch/shared';
import { getTelegramIdentity } from './telegram';

// Dev and tunnel traffic must reach the local Worker through Vite's /api proxy. Otherwise a
// production VITE_API_URL left in apps/web/.env validates Telegram initData with another bot.
const API_BASE = import.meta.env.DEV ? '' : import.meta.env.VITE_API_URL ?? '';
const DISPLAY_NAME_SEED_KEY = 'clutch_display_name_seed_v1';
const PLAYER_NAME_KEY = 'clutch_player_name_v1';
const GUEST_SESSION_KEY = 'clutch_guest_session_v1';
const SESSION_REFRESH_WINDOW_MS = 5 * 60 * 1000;
export const WIKI_PATH_REQUEST_TIMEOUT_MS = 15_000;
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

export function getPlayerName(): string {
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

export async function apiFetch<T>(
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
