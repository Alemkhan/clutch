import type { CategoryId, CompleteSoloRunResponse, PracticeLevelId, MyRunsResponse, SoloAnswerRequest, SoloHammerRequest, SoloProfileResponse, SoloRoundResponse, SoloRunSnapshot, StartSoloRunRequest, StartSoloRunResponse, TrainingCheckRequest, TrainingCheckResponse, TrainingMistakesResponse, TrainingQuestionsRequest, TrainingQuestionsResponse } from '@clutch/shared';
import { apiFetch, getPlayerName } from './apiClient';
import { getTelegramIdentity } from './telegram';

// ---- Соло-забег и «Мои партии» ----

export function startSoloRun(
  category: CategoryId,
  signal?: AbortSignal,
  rematchInviteId?: string,
  botLevel?: PracticeLevelId,
  mode?: StartSoloRunRequest['mode'],
  groupChallengeId?: string,
): Promise<StartSoloRunResponse> {
  const telegram = getTelegramIdentity();
  const body: StartSoloRunRequest = {
    displayName: telegram?.displayName || getPlayerName(),
    category,
    ...(groupChallengeId ? { groupChallengeId } : {}),
    ...(rematchInviteId ? { rematchInviteId } : {}),
    ...(botLevel ? { botLevel } : {}),
    ...(mode && !botLevel && !rematchInviteId && !groupChallengeId ? { mode } : {}),
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

export function createGroupChallenge(runId: string): Promise<import('@clutch/shared').CreateGroupChallengeResponse> {
  return apiFetch(`/api/solo-runs/${encodeURIComponent(runId)}/group-challenge`, { method: 'POST', body: '{}' });
}
export function fetchGroupChallenge(id: string, signal?: AbortSignal): Promise<import('@clutch/shared').GroupChallengePreviewResponse> {
  return apiFetch(`/api/group-challenges/${encodeURIComponent(id)}`, { method: 'GET' }, signal);
}
