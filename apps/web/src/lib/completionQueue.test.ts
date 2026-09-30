import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompleteAsyncMatchResponse } from '@clutch/shared';
import { ApiError } from './api';
import {
  CompletionQueue,
  canonicalCompletionPayload,
  isValidCompletionAck,
} from './completionQueue';

class MemoryStorage {
  values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const payload = {
  rounds: [{ questionId: 'q1', selectedAnswer: 'a', responseTimeMs: 500 }],
};

function ack(matchId: string, playerProgress = 25): CompleteAsyncMatchResponse {
  return {
    matchId,
    rounds: [{
      questionId: 'q1', correct: true, responseTimeMs: 500,
      skillResult: 'perfect', progressAwarded: 25, playerProgressAfter: playerProgress,
    }],
    playerProgress,
    correctCount: 1,
  };
}

describe('completion queue', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists canonical versioned entries and restores them after reload', () => {
    const storage = new MemoryStorage();
    const queue = new CompletionQueue({ storage, now: () => 10 });
    const dirtyPayload = {
      rounds: [{ ...payload.rounds[0], ignored: 'value' }],
    } as unknown as typeof payload;

    queue.enqueue('match-1', dirtyPayload, 30);
    const restored = new CompletionQueue({ storage, now: () => 20 });

    expect(restored.get('match-1')).toMatchObject({
      version: 1, matchId: 'match-1', opponentProgress: 30, attempts: 0,
      payload,
    });
    expect(restored.get('match-1')?.payload.rounds[0]).not.toHaveProperty('ignored');
  });

  it('rejects a twenty-first entry instead of evicting an unsaved result', () => {
    const queue = new CompletionQueue({ storage: new MemoryStorage(), now: () => 1 });
    for (let index = 0; index < 20; index += 1) queue.enqueue(`match-${index}`, payload, 0);
    expect(queue.list()).toHaveLength(20);
    expect(() => queue.enqueue('match-20', payload, 0)).toThrow(/queue is full/i);
    expect(queue.get('match-0')).toBeDefined();
  });

  it('is single-flight, confirms the same match, records stats, and removes the entry', async () => {
    const localStorage = new MemoryStorage();
    vi.stubGlobal('localStorage', localStorage);
    let resolveSend!: (response: CompleteAsyncMatchResponse) => void;
    const send = vi.fn(() => new Promise<CompleteAsyncMatchResponse>((resolve) => { resolveSend = resolve; }));
    const queue = new CompletionQueue({ storage: localStorage, send });
    const events: string[] = [];
    queue.subscribe((event) => events.push(event.type));
    queue.enqueue('match-1', payload, 10);

    const first = queue.flush();
    const second = queue.flush();
    expect(first).toBe(second);
    expect(send).toHaveBeenCalledTimes(1);
    resolveSend(ack('match-1'));
    await first;

    expect(queue.get('match-1')).toBeUndefined();
    expect(events).toContain('confirmed');
    expect(JSON.parse(localStorage.getItem('clutch_confirmed_stats_v1')!)).toMatchObject({
      wins: 1, matchesPlayed: 1, confirmedMatchIds: ['match-1'],
    });
  });

  it('uses bounded 1/3/10 second retry delays and stops after four attempts', async () => {
    let now = 0;
    const send = vi.fn().mockRejectedValue(new TypeError('offline'));
    const queue = new CompletionQueue({
      storage: new MemoryStorage(), send, now: () => now,
      schedule: (() => 1) as unknown as typeof setTimeout,
      cancel: () => {},
    });
    queue.enqueue('match-1', payload, 0);

    await queue.flush();
    expect(queue.get('match-1')).toMatchObject({
      attempts: 1, status: 'pending', nextAttemptAt: 1_000, terminal: false,
    });
    now = 1_000;
    await queue.flush();
    expect(queue.get('match-1')).toMatchObject({ attempts: 2, nextAttemptAt: 4_000, terminal: false });
    now = 4_000;
    await queue.flush();
    expect(queue.get('match-1')).toMatchObject({ attempts: 3, nextAttemptAt: 14_000, terminal: false });
    now = 14_000;
    await queue.flush();
    expect(queue.get('match-1')).toMatchObject({ attempts: 4, status: 'error', terminal: true });
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('keeps a timeout entry and accepts the idempotent ACK on the next send', async () => {
    let now = 0;
    const send = vi.fn()
      .mockRejectedValueOnce(new DOMException('timed out', 'AbortError'))
      .mockResolvedValueOnce(ack('match-1', 25));
    const queue = new CompletionQueue({
      storage: new MemoryStorage(), send, now: () => now,
      schedule: (() => 1) as unknown as typeof setTimeout,
      cancel: () => {},
    });
    queue.enqueue('match-1', payload, 10);

    await queue.flush();
    expect(queue.get('match-1')).toMatchObject({ status: 'pending', attempts: 1 });
    now = 1_000;
    await queue.flush();

    expect(send).toHaveBeenCalledTimes(2);
    expect(queue.get('match-1')).toBeUndefined();
  });

  it('respects Retry-After for a rate-limited completion', async () => {
    let now = 2_000;
    const queue = new CompletionQueue({
      storage: new MemoryStorage(),
      send: vi.fn().mockRejectedValue(new ApiError(429, 60_000)),
      now: () => now,
      schedule: (() => 1) as unknown as typeof setTimeout,
      cancel: () => {},
    });
    queue.enqueue('match-1', payload, 0);

    await queue.flush();

    expect(queue.get('match-1')).toMatchObject({
      attempts: 1,
      status: 'pending',
      nextAttemptAt: now + 60_000,
    });
  });

  it('retains 4xx and invalid acknowledgements as terminal errors', async () => {
    const badRequest = new CompletionQueue({
      storage: new MemoryStorage(), send: vi.fn().mockRejectedValue(new ApiError(400)),
    });
    badRequest.enqueue('match-1', payload, 0);
    await badRequest.flush();
    expect(badRequest.get('match-1')).toMatchObject({ attempts: 1, status: 'error', terminal: true });
    badRequest.retry('match-1');
    expect(badRequest.get('match-1')).toMatchObject({ attempts: 1, status: 'error', terminal: true });

    const invalidAck = new CompletionQueue({
      storage: new MemoryStorage(), send: vi.fn().mockResolvedValue(ack('different-match')),
    });
    invalidAck.enqueue('match-1', payload, 0);
    await invalidAck.flush();
    expect(invalidAck.get('match-1')).toMatchObject({ attempts: 1, status: 'error', terminal: true });
  });

  it('manual retry resets a terminal lifecycle', async () => {
    const storage = new MemoryStorage();
    storage.setItem('clutch_completion_queue_v1', JSON.stringify([{
      version: 1,
      matchId: 'match-1',
      payload,
      opponentProgress: 0,
      createdAt: 1,
      attempts: 4,
      nextAttemptAt: 1,
      status: 'error',
      terminal: true,
      canRetry: true,
      error: 'offline',
    }]));
    const send = vi.fn().mockResolvedValue(ack('match-1'));
    const queue = new CompletionQueue({ storage, send });

    queue.retry('match-1');
    await vi.waitFor(() => expect(queue.get('match-1')).toBeUndefined());
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid opponent progress snapshot', () => {
    const queue = new CompletionQueue({ storage: new MemoryStorage() });
    expect(() => queue.enqueue('match-1', payload, 101)).toThrow(/opponentProgress/);
  });
});

describe('completion payload and ACK validation', () => {
  it('copies only canonical request fields', () => {
    expect(canonicalCompletionPayload(payload)).toEqual(payload);
    expect(canonicalCompletionPayload(payload)).not.toBe(payload);
  });

  it('requires the same match and bounded integer summary fields', () => {
    expect(isValidCompletionAck(ack('match-1'), 'match-1')).toBe(true);
    expect(isValidCompletionAck(ack('other'), 'match-1')).toBe(false);
    expect(isValidCompletionAck({ ...ack('match-1'), playerProgress: 101 }, 'match-1')).toBe(false);
    expect(isValidCompletionAck({ ...ack('match-1'), correctCount: 2 }, 'match-1')).toBe(false);
    expect(isValidCompletionAck({ ...ack('match-1'), correctCount: 0 }, 'match-1')).toBe(false);
    expect(isValidCompletionAck({ ...ack('match-1'), rounds: null }, 'match-1')).toBe(false);
    expect(isValidCompletionAck({
      ...ack('match-1'),
      rounds: [{ ...ack('match-1').rounds[0], skillResult: 'unknown' }],
    }, 'match-1')).toBe(false);
    expect(isValidCompletionAck({
      ...ack('match-1'),
      rounds: [{ ...ack('match-1').rounds[0], playerProgressAfter: 24 }],
    }, 'match-1')).toBe(false);
  });
});
