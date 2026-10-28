import { apiFetch } from './apiClient';

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
