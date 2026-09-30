import type {
  AsyncMatchRoundInput,
  CompleteAsyncMatchRequest,
  CompleteAsyncMatchResponse,
} from '@clutch/shared';
import { ApiError, completeAsyncMatch, isTransientApiError } from './api';
import { recordConfirmedMatch } from './localStats';

const STORAGE_KEY = 'clutch_completion_queue_v1';
const VERSION = 1;
const MAX_ENTRIES = 20;
const RETRY_DELAYS_MS = [1_000, 3_000, 10_000] as const;
const MAX_ATTEMPTS = 4;
const MAX_RETRY_AFTER_MS = 5 * 60_000;

export type CompletionStatus = 'pending' | 'error';

export interface CompletionQueueEntry {
  version: typeof VERSION;
  matchId: string;
  payload: CompleteAsyncMatchRequest;
  opponentProgress: number;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  status: CompletionStatus;
  terminal: boolean;
  canRetry: boolean;
  error?: string;
}

export type CompletionQueueEvent =
  | { type: 'changed'; entry: CompletionQueueEntry }
  | { type: 'confirmed'; entry: CompletionQueueEntry; response: CompleteAsyncMatchResponse };

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface CompletionQueueDependencies {
  storage?: StorageLike;
  send?: (matchId: string, payload: CompleteAsyncMatchRequest) => Promise<CompleteAsyncMatchResponse>;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancel?: (handle: ReturnType<typeof setTimeout>) => void;
}

function canonicalRound(round: AsyncMatchRoundInput): AsyncMatchRoundInput {
  return {
    questionId: round.questionId,
    selectedAnswer: round.selectedAnswer,
    responseTimeMs: round.responseTimeMs,
    ...(round.skillDistance === undefined ? {} : { skillDistance: round.skillDistance }),
  };
}

export function canonicalCompletionPayload(payload: CompleteAsyncMatchRequest): CompleteAsyncMatchRequest {
  return { rounds: payload.rounds.map(canonicalRound) };
}

export function isValidCompletionAck(
  value: unknown,
  expectedMatchId: string,
): value is CompleteAsyncMatchResponse {
  if (!value || typeof value !== 'object') return false;
  const response = value as Partial<CompleteAsyncMatchResponse>;
  return response.matchId === expectedMatchId
    && Array.isArray(response.rounds)
    && response.rounds.length >= 1
    && response.rounds.length <= 10
    && response.rounds.every((round) => (
      Boolean(round)
      && typeof round.questionId === 'string' && round.questionId.length > 0
      && typeof round.correct === 'boolean'
      && Number.isInteger(round.responseTimeMs) && round.responseTimeMs >= 0
      && round.responseTimeMs <= 60_000
      && (round.skillResult === undefined
        || ['perfect', 'great', 'good', 'weak', 'miss'].includes(round.skillResult))
      && Number.isInteger(round.progressAwarded) && round.progressAwarded >= 0
      && round.progressAwarded <= 25
      && Number.isInteger(round.playerProgressAfter)
      && round.playerProgressAfter >= 0 && round.playerProgressAfter <= 100
    ))
    && Number.isInteger(response.playerProgress)
    && response.playerProgress! >= 0
    && response.playerProgress! <= 100
    && Number.isInteger(response.correctCount)
    && response.correctCount! >= 0
    && response.correctCount! <= response.rounds.length
    && response.correctCount === response.rounds.filter((round) => round.correct).length
    && response.rounds[response.rounds.length - 1].playerProgressAfter === response.playerProgress;
}

class InvalidCompletionAckError extends Error {
  constructor() {
    super('Server returned an invalid completion confirmation.');
    this.name = 'InvalidCompletionAckError';
  }
}

function validEntry(value: unknown): value is CompletionQueueEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<CompletionQueueEntry>;
  return entry.version === VERSION
    && typeof entry.matchId === 'string' && entry.matchId.length > 0
    && typeof entry.opponentProgress === 'number' && Number.isInteger(entry.opponentProgress)
    && entry.opponentProgress >= 0 && entry.opponentProgress <= 100
    && typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt)
    && typeof entry.attempts === 'number' && Number.isSafeInteger(entry.attempts) && entry.attempts >= 0
    && typeof entry.nextAttemptAt === 'number' && Number.isFinite(entry.nextAttemptAt)
    && (entry.status === 'pending' || entry.status === 'error')
    && typeof entry.terminal === 'boolean'
    && typeof entry.canRetry === 'boolean'
    && Boolean(entry.payload) && Array.isArray(entry.payload?.rounds)
    && entry.payload.rounds.every((round) => (
      Boolean(round)
      && typeof round.questionId === 'string'
      && typeof round.selectedAnswer === 'string'
      && typeof round.responseTimeMs === 'number'
      && (round.skillDistance === undefined || typeof round.skillDistance === 'number')
    ));
}

export class CompletionQueueFullError extends Error {
  constructor() {
    super('Completion queue is full.');
    this.name = 'CompletionQueueFullError';
  }
}

export class CompletionQueue {
  private readonly storage: StorageLike | undefined;
  private readonly send: NonNullable<CompletionQueueDependencies['send']>;
  private readonly now: NonNullable<CompletionQueueDependencies['now']>;
  private readonly schedule: NonNullable<CompletionQueueDependencies['schedule']>;
  private readonly cancel: NonNullable<CompletionQueueDependencies['cancel']>;
  private entries: CompletionQueueEntry[];
  private listeners = new Set<(event: CompletionQueueEvent) => void>();
  private flushPromise: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(dependencies: CompletionQueueDependencies = {}) {
    this.storage = dependencies.storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
    this.send = dependencies.send ?? completeAsyncMatch;
    this.now = dependencies.now ?? Date.now;
    this.schedule = dependencies.schedule ?? setTimeout;
    this.cancel = dependencies.cancel ?? clearTimeout;
    this.entries = this.read();
  }

  list(): CompletionQueueEntry[] {
    return this.entries.map((entry) => ({ ...entry, payload: canonicalCompletionPayload(entry.payload) }));
  }

  get(matchId: string): CompletionQueueEntry | undefined {
    return this.list().find((entry) => entry.matchId === matchId);
  }

  subscribe(listener: (event: CompletionQueueEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  enqueue(matchId: string, payload: CompleteAsyncMatchRequest, opponentProgress: number): CompletionQueueEntry {
    const existing = this.entries.find((entry) => entry.matchId === matchId);
    if (existing) return { ...existing, payload: canonicalCompletionPayload(existing.payload) };
    if (this.entries.length >= MAX_ENTRIES) throw new CompletionQueueFullError();
    if (!Number.isInteger(opponentProgress) || opponentProgress < 0 || opponentProgress > 100) {
      throw new RangeError('opponentProgress must be an integer from 0 to 100.');
    }
    const entry: CompletionQueueEntry = {
      version: VERSION,
      matchId,
      payload: canonicalCompletionPayload(payload),
      opponentProgress,
      createdAt: this.now(),
      attempts: 0,
      nextAttemptAt: this.now(),
      status: 'pending',
      terminal: false,
      canRetry: true,
    };
    this.entries = [...this.entries, entry];
    this.persist();
    this.emit({ type: 'changed', entry });
    return { ...entry, payload: canonicalCompletionPayload(entry.payload) };
  }

  retry(matchId: string): void {
    const entry = this.entries.find((candidate) => candidate.matchId === matchId);
    if (!entry || !entry.canRetry) return;
    entry.attempts = 0;
    entry.nextAttemptAt = this.now();
    entry.status = 'pending';
    entry.terminal = false;
    entry.canRetry = true;
    delete entry.error;
    this.persist();
    this.emit({ type: 'changed', entry });
    void this.flush();
  }

  flush(): Promise<void> {
    if (this.flushPromise) return this.flushPromise;
    if (this.timer !== null) {
      this.cancel(this.timer);
      this.timer = null;
    }
    this.flushPromise = this.flushReady().finally(() => {
      this.flushPromise = null;
      this.armTimer();
    });
    return this.flushPromise;
  }

  private async flushReady(): Promise<void> {
    for (const entry of [...this.entries]) {
      if (entry.terminal || entry.nextAttemptAt > this.now()) continue;
      await this.attempt(entry);
    }
  }

  private async attempt(entry: CompletionQueueEntry): Promise<void> {
    entry.attempts += 1;
    entry.status = 'pending';
    delete entry.error;
    this.persist();
    this.emit({ type: 'changed', entry });
    try {
      const response = await this.send(entry.matchId, canonicalCompletionPayload(entry.payload));
      if (!isValidCompletionAck(response, entry.matchId)) throw new InvalidCompletionAckError();
      recordConfirmedMatch(entry.matchId, response.playerProgress, entry.opponentProgress);
      this.entries = this.entries.filter((candidate) => candidate.matchId !== entry.matchId);
      this.persist();
      this.emit({ type: 'confirmed', entry, response });
    } catch (error) {
      const transient = !(error instanceof InvalidCompletionAckError) && isTransientApiError(error);
      const exhausted = entry.attempts >= MAX_ATTEMPTS;
      entry.status = !transient || exhausted ? 'error' : 'pending';
      entry.terminal = !transient || exhausted;
      entry.canRetry = transient;
      entry.error = error instanceof Error ? error.message : 'Не удалось сохранить результат.';
      if (!entry.terminal) {
        const retryAfterMs = error instanceof ApiError ? error.retryAfterMs ?? 0 : 0;
        entry.nextAttemptAt = this.now() + Math.max(
          RETRY_DELAYS_MS[entry.attempts - 1],
          Math.min(retryAfterMs, MAX_RETRY_AFTER_MS),
        );
      }
      this.persist();
      this.emit({ type: 'changed', entry });
    }
  }

  private armTimer(): void {
    const next = this.entries
      .filter((entry) => !entry.terminal)
      .reduce<number | undefined>((minimum, entry) => (
        minimum === undefined ? entry.nextAttemptAt : Math.min(minimum, entry.nextAttemptAt)
      ), undefined);
    if (next === undefined) return;
    this.timer = this.schedule(() => {
      this.timer = null;
      void this.flush();
    }, Math.max(0, next - this.now()));
  }

  private read(): CompletionQueueEntry[] {
    try {
      const parsed: unknown = JSON.parse(this.storage?.getItem(STORAGE_KEY) ?? '[]');
      return Array.isArray(parsed) ? parsed.filter(validEntry).slice(-MAX_ENTRIES) : [];
    } catch {
      return [];
    }
  }

  private persist(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.entries));
    } catch {
      // The in-memory queue remains useful when durable storage is unavailable.
    }
  }

  private emit(event: CompletionQueueEvent): void {
    const snapshot = event.type === 'confirmed'
      ? { ...event, entry: { ...event.entry, payload: canonicalCompletionPayload(event.entry.payload) } }
      : { ...event, entry: { ...event.entry, payload: canonicalCompletionPayload(event.entry.payload) } };
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

export const completionQueue = new CompletionQueue();
