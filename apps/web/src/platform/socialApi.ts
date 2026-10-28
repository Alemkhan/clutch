import type { CategoryId, CreateFriendInviteResponse, CreateRematchInviteResponse, DuelBoardResponse, PreparedShareResponse, SoloLeaderboardResponse } from '@clutch/shared';
import { apiFetch } from './apiClient';

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
