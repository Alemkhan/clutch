import type {
  CategoryId,
  CompleteAsyncMatchRequest,
  CompleteAsyncMatchResponse,
  GuestSessionResponse,
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
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init.headers },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Clutch API returned ${response.status}`);
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
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

async function apiFetch<T>(path: string, init: RequestInit): Promise<T> {
  const authorization = await authorizationHeader();
  return rawApiFetch(path, {
    ...init,
    headers: { ...init.headers, Authorization: authorization },
  });
}

export function startAsyncMatch(category: CategoryId): Promise<StartAsyncMatchResponse> {
  const telegram = getTelegramIdentity();
  const body: StartAsyncMatchRequest = {
    displayName: telegram?.displayName || getPlayerName(),
    category,
  };
  return apiFetch('/api/async-matches', {
    method: 'POST',
    body: JSON.stringify(body),
  });
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
