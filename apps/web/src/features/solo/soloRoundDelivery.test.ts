import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../platform/api';
import { deliverRound } from './soloRoundDelivery';
import { parseSoloRound } from './soloResultModel';

const noSleep = vi.fn(async () => undefined);

describe('round delivery', () => {
  it('repeats the same round after a lost connection until the server answers', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new ApiError(503))
      .mockResolvedValueOnce('verdict');
    const result = await deliverRound(send, { signal: new AbortController().signal, delaysMs: [1, 1, 1], sleep: noSleep });
    expect(result).toEqual({ ok: true, value: 'verdict' });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('does not retry a rejected round', async () => {
    const send = vi.fn().mockRejectedValue(new ApiError(400));
    const result = await deliverRound(send, { signal: new AbortController().signal, delaysMs: [1, 1], sleep: noSleep });
    expect(result).toMatchObject({ ok: false, transient: false });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('gives up after the last delay but reports the failure as retryable by the player', async () => {
    const send = vi.fn().mockRejectedValue(new TypeError('offline'));
    const result = await deliverRound(send, { signal: new AbortController().signal, delaysMs: [1, 1], sleep: noSleep });
    expect(result).toMatchObject({ ok: false, transient: true });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('honours Retry-After and stops when aborted', async () => {
    const sleep = vi.fn(async () => undefined);
    const send = vi.fn().mockRejectedValueOnce(new ApiError(429, 5000)).mockResolvedValueOnce('ok');
    await deliverRound(send, { signal: new AbortController().signal, delaysMs: [100], sleep });
    expect(sleep).toHaveBeenCalledWith(5000, expect.anything());

    const controller = new AbortController();
    const aborting = vi.fn(async () => { controller.abort(); throw new TypeError('x'); });
    await deliverRound(aborting, { signal: controller.signal, delaysMs: [1, 1], sleep: noSleep });
    expect(aborting).toHaveBeenCalledTimes(1);
  });
});

describe('parseSoloRound', () => {
  const valid = {
    runId: 'r', roundIndex: 0, questionId: 'q', correct: true, explanation: 'e', awaitingHammer: true,
    skillResult: null, progressAwarded: 0, progress: 0, roundsPlayed: 0, status: 'in_progress',
    reachedTarget: false, result: null,
  };

  it('accepts a server verdict and rejects a foreign or malformed one', () => {
    expect(parseSoloRound(valid, 'r')).toMatchObject({ questionId: 'q' });
    expect(parseSoloRound(valid, 'other')).toBeNull();
    expect(parseSoloRound({ ...valid, correct: 'yes' }, 'r')).toBeNull();
    expect(parseSoloRound({ ...valid, correct: false, awaitingHammer: true }, 'r')).toBeNull();
    expect(parseSoloRound({ ...valid, progress: 150 }, 'r')).toBeNull();
    expect(parseSoloRound(null, 'r')).toBeNull();
  });
});
