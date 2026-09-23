import type {
  CategoryId,
  CompleteAsyncMatchRequest,
  CompleteAsyncMatchResponse,
  StartAsyncMatchRequest,
  StartAsyncMatchResponse,
} from '@clutch/shared';
import { getTelegramIdentity } from './telegram';

const API_BASE = import.meta.env.VITE_API_URL ?? '';
const PLAYER_ID_KEY = 'clutch_player_id_v1';
const PLAYER_NAME_KEY = 'clutch_player_name_v1';

function getOrCreatePlayerId(): string {
  try {
    const stored = localStorage.getItem(PLAYER_ID_KEY);
    if (stored) return stored;
    const created = crypto.randomUUID();
    localStorage.setItem(PLAYER_ID_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

function getPlayerName(): string {
  try {
    return localStorage.getItem(PLAYER_NAME_KEY)?.trim()
      || `Игрок ${getOrCreatePlayerId().slice(0, 4)}`;
  } catch {
    return 'Игрок';
  }
}

async function apiFetch<T>(path: string, init: RequestInit): Promise<T> {
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

export function startAsyncMatch(category: CategoryId): Promise<StartAsyncMatchResponse> {
  const telegram = getTelegramIdentity();
  const body: StartAsyncMatchRequest = {
    playerId: getOrCreatePlayerId(),
    displayName: telegram?.displayName || getPlayerName(),
    category,
    telegramInitData: telegram?.initData,
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
