import type {
  ClanBoardResponse,
  ClanCheckResponse,
  ClanDetailResponse,
  ClanJoinResponse,
  ClanMeResponse,
} from '@clutch/shared';
import { apiFetch } from './apiClient';

/** Свой клан; без клана — можно ли уже занять эмодзи. */
export function fetchMyClan(signal?: AbortSignal): Promise<ClanMeResponse> {
  return apiFetch('/api/clans/me', { method: 'GET' }, signal);
}

/** Свободно ли эмодзи. 400 — это не одно эмодзи. */
export function checkClanEmoji(emoji: string, signal?: AbortSignal): Promise<ClanCheckResponse> {
  return apiFetch(`/api/clans/check?emoji=${encodeURIComponent(emoji)}`, { method: 'GET' }, signal);
}

/** Занять эмодзи навсегда. 409 taken / already_member, 403 needs_run. */
export function foundClan(emoji: string): Promise<ClanMeResponse> {
  return apiFetch('/api/clans', { method: 'POST', body: JSON.stringify({ emoji }) });
}

/** Вступить по ссылке-приглашению (код `cl_…` из startapp). */
export function joinClan(code: string, signal?: AbortSignal): Promise<ClanJoinResponse> {
  return apiFetch('/api/clans/join', { method: 'POST', body: JSON.stringify({ code }) }, signal);
}

export function fetchClanBoard(signal?: AbortSignal): Promise<ClanBoardResponse> {
  return apiFetch('/api/clans/board', { method: 'GET' }, signal);
}

export function fetchClan(slug: string, signal?: AbortSignal): Promise<ClanDetailResponse> {
  return apiFetch(`/api/clans/${encodeURIComponent(slug)}`, { method: 'GET' }, signal);
}
