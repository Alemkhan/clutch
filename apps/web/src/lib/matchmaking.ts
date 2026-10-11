import { abandonedAtRound, type Opponent } from '@clutch/shared';
import { ApiError } from './api';

export type MatchSource = 'player' | 'bot' | 'local';
export type MatchmakingStatus = 'loading' | 'ready' | 'error';

export interface MatchmakingViewState {
  status: MatchmakingStatus;
  error?: string;
}

export const MATCH_SOURCE_LABELS: Record<MatchSource, string> = {
  player: 'Запись игрока',
  bot: 'Бот',
  local: 'Локальная практика',
};

/**
 * Honest note for a recorded player who stopped before the end of the set without reaching 100.
 * Derived from the transcript; a player who won early by reaching 100 is not "abandoned".
 */
export function abandonedNote(
  source: MatchSource,
  opponent: Opponent,
  questionCount: number,
): string | null {
  if (source !== 'player') return null;
  const round = abandonedAtRound(opponent.rounds, questionCount);
  return round === null ? null : `Запись оборвалась на ${round}-м вопросе`;
}

export function matchmakingErrorMessage(error: unknown): string {
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    return 'Не удалось подтвердить сессию или доступ. Вернись в Telegram или обнови страницу.';
  }
  if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 425 && error.status !== 429) {
    return 'Сервер не смог создать матч. Попробуй ещё раз.';
  }
  return 'Матчмейкинг временно недоступен. Проверь соединение и попробуй ещё раз.';
}

interface ActiveRequest {
  key: string;
  token: number;
  controller: AbortController;
}

export interface MatchRequestHandle {
  token: number;
  signal: AbortSignal;
}

/** Keeps only one request per current selection and rejects late responses. */
export class MatchRequestCoordinator {
  private sequence = 0;
  private active?: ActiveRequest;

  begin(key: string): MatchRequestHandle | null {
    if (this.active?.key === key) return null;
    this.cancel();
    const controller = new AbortController();
    const active = { key, token: ++this.sequence, controller };
    this.active = active;
    return { token: active.token, signal: controller.signal };
  }

  isCurrent(token: number): boolean {
    return this.active?.token === token;
  }

  settle(token: number): boolean {
    if (!this.isCurrent(token)) return false;
    this.active = undefined;
    return true;
  }

  cancel(): void {
    if (this.active) this.active.controller.abort();
    this.active = undefined;
    this.sequence += 1;
  }
}
