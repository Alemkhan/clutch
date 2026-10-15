import { describe, expect, it, vi } from 'vitest';
import type { TiebreakerTodayResponse } from '@clutch/shared';
import { ApiError } from './api';
import { TiebreakerSubmitter, isTiebreakerState } from './tiebreakerSubmit';

const state: TiebreakerTodayResponse = {
  dateKey: '2026-10-15',
  question: { id: 'q1', number: 7, prompt: 'Сколько?', cardPrompt: null, unit: 'м' },
  answered: {
    guess: 10, multiplier: 2, answer: 5, sourceUrl: 'https://example.org/x', asOfDate: '2026-01-01', explanation: null,
    distribution: new Array<number>(12).fill(0), totalAnswers: 1, percentile: null,
  },
  answersCount: 1,
};
const body = { questionId: 'q1', guess: 10 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

describe('TiebreakerSubmitter', () => {
  it('sends one request for a double tap and ignores the second call', async () => {
    const gate = deferred<TiebreakerTodayResponse>();
    const answer = vi.fn(() => gate.promise);
    const submitter = new TiebreakerSubmitter({ answer });
    const first = submitter.submit(body);
    expect(submitter.busy).toBe(true);
    expect(await submitter.submit(body)).toBeNull();
    gate.resolve(state);
    expect(await first).toEqual({ kind: 'answered', state });
    expect(answer).toHaveBeenCalledTimes(1);
    expect(submitter.busy).toBe(false);
  });

  it('shows the saved state from a 409 already_answered body', async () => {
    const submitter = new TiebreakerSubmitter({
      answer: async () => { throw new ApiError(409, undefined, 'already_answered', { reason: 'already_answered', ...state }); },
    });
    expect(await submitter.submit(body)).toEqual({
      kind: 'already_answered',
      state: expect.objectContaining({ dateKey: '2026-10-15' }),
    });
  });

  it('falls back to a re-read when the 409 body has no state', async () => {
    const submitter = new TiebreakerSubmitter({
      answer: async () => { throw new ApiError(409, undefined, 'already_answered', { reason: 'already_answered' }); },
    });
    expect(await submitter.submit(body)).toEqual({ kind: 'already_answered', state: null });
  });

  it('asks for a re-read on not_todays_question', async () => {
    const submitter = new TiebreakerSubmitter({
      answer: async () => { throw new ApiError(409, undefined, 'not_todays_question', {}); },
    });
    expect(await submitter.submit(body)).toEqual({ kind: 'stale' });
  });

  it('keeps the input retryable after a network error, and allows another send', async () => {
    const answer = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new ApiError(503))
      .mockResolvedValueOnce(state);
    const submitter = new TiebreakerSubmitter({ answer });
    expect(await submitter.submit(body)).toEqual({ kind: 'network' });
    expect(await submitter.submit(body)).toEqual({ kind: 'network' });
    expect(await submitter.submit(body)).toEqual({ kind: 'answered', state });
  });

  it('reports a rejected answer when the server says 400', async () => {
    const submitter = new TiebreakerSubmitter({
      answer: async () => { throw new ApiError(400, undefined, 'invalid_guess', {}); },
    });
    expect(await submitter.submit(body)).toEqual({ kind: 'rejected' });
  });

  it('recognises a complete saved state only', () => {
    expect(isTiebreakerState(state)).toBe(true);
    expect(isTiebreakerState({ ...state, answered: null })).toBe(false);
    expect(isTiebreakerState(null)).toBe(false);
  });
});
