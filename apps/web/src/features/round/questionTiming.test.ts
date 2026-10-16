import { describe, expect, it } from 'vitest';
import {
  createQuestionReadiness,
  createQuestionTiming,
  displayedQuestionSecond,
  isTooEarlyForOptionTap,
  MIN_OPTION_TAP_MS,
  markQuestionMediaError,
  markQuestionMediaReady,
  nextCountdownTick,
  QuestionSubmissionGate,
  remainingQuestionMs,
  retryQuestionMedia,
} from './questionTiming';

describe('early option taps', () => {
  it('ignores the second tap of a double tap on the resolution screen but not a real answer', () => {
    const timing = createQuestionTiming(5_000, 15_000);
    expect(isTooEarlyForOptionTap(timing, 5_020)).toBe(true);
    expect(isTooEarlyForOptionTap(timing, 5_000 + MIN_OPTION_TAP_MS - 1)).toBe(true);
    expect(isTooEarlyForOptionTap(timing, 5_000 + MIN_OPTION_TAP_MS)).toBe(false);
  });
});

describe('question timing', () => {
  it('derives remaining time from the absolute deadline after a throttled large jump', () => {
    const timing = createQuestionTiming(1_000, 15_000);
    expect(remainingQuestionMs(timing.deadlineMs, 1_100)).toBe(14_900);
    expect(remainingQuestionMs(timing.deadlineMs, 14_750)).toBe(1_250);
    expect(displayedQuestionSecond(1_250)).toBe(2);
  });

  it('continues expiring while hidden and is immediately expired on resume', () => {
    const timing = createQuestionTiming(5_000, 15_000);
    expect(remainingQuestionMs(timing.deadlineMs, 8_000)).toBe(12_000);
    expect(remainingQuestionMs(timing.deadlineMs, 25_000)).toBe(0);
  });

  it('emits each visible countdown tick at most once', () => {
    const played = new Set<number>();
    expect(nextCountdownTick(2_900, played)).toBe(3);
    played.add(3);
    expect(nextCountdownTick(2_100, played)).toBeNull();
    expect(nextCountdownTick(1_900, played)).toBe(2);
    played.add(2);
    expect(nextCountdownTick(400, played)).toBe(1);
  });
});

describe('question media readiness', () => {
  it('starts a question without media immediately', () => {
    const readiness = createQuestionReadiness(false, 1_000, 15_000);
    expect(readiness).toEqual({
      status: 'ready', requestKey: 0,
      timing: { startedAtMs: 1_000, deadlineMs: 16_000 },
    });
  });

  it('keeps a media question pending without a deadline', () => {
    expect(createQuestionReadiness(true, 1_000, 15_000)).toEqual({
      status: 'pending', requestKey: 0, timing: null,
    });
  });

  it('creates one timing only after the first successful media load', () => {
    const pending = createQuestionReadiness(true, 1_000, 15_000);
    const ready = markQuestionMediaReady(pending, 0, 4_000, 15_000);
    expect(ready.timing).toEqual({ startedAtMs: 4_000, deadlineMs: 19_000 });
    expect(markQuestionMediaReady(ready, 0, 8_000, 15_000)).toBe(ready);
  });

  it('recovers from an error through a new request before starting once', () => {
    const pending = createQuestionReadiness(true, 1_000, 15_000);
    const failed = markQuestionMediaError(pending, 0);
    const retrying = retryQuestionMedia(failed);
    const ready = markQuestionMediaReady(retrying, 1, 7_000, 15_000);

    expect(failed).toMatchObject({ status: 'error', timing: null });
    expect(retrying).toMatchObject({ status: 'pending', requestKey: 1, timing: null });
    expect(markQuestionMediaReady(retrying, 0, 6_000, 15_000)).toBe(retrying);
    expect(markQuestionMediaError(retrying, 0)).toBe(retrying);
    expect(ready).toMatchObject({
      status: 'ready', requestKey: 1,
      timing: { startedAtMs: 7_000, deadlineMs: 22_000 },
    });
    expect(markQuestionMediaError(ready, 1)).toBe(ready);
    expect(markQuestionMediaReady(ready, 1, 9_000, 15_000)).toBe(ready);
    expect(retryQuestionMedia(ready)).toBe(ready);
  });
});

describe('question submission gate', () => {
  const timing = createQuestionTiming(10_000, 15_000);

  it('lets an answer before the deadline win and remains one-shot', () => {
    const gate = new QuestionSubmissionGate(timing);
    expect(gate.answer('a', 24_999)).toEqual({ kind: 'answer', answer: 'a', elapsedMs: 14_999 });
    expect(gate.answer('b', 24_999)).toBeNull();
    expect(gate.expire(25_000)).toBeNull();
  });

  it('makes timeout win at the exact deadline', () => {
    const gate = new QuestionSubmissionGate(timing);
    expect(gate.answer('a', 25_000)).toEqual({
      kind: 'timeout',
      answer: '__timeout__',
      elapsedMs: 15_000,
    });
    expect(gate.expire(25_000)).toBeNull();
  });

  it('settles an expiry/answer race only once', () => {
    const expiryFirst = new QuestionSubmissionGate(timing);
    expect(expiryFirst.expire(26_000)?.kind).toBe('timeout');
    expect(expiryFirst.answer('a', 24_000)).toBeNull();

    const answerFirst = new QuestionSubmissionGate(timing);
    expect(answerFirst.answer('a', 24_000)?.kind).toBe('answer');
    expect(answerFirst.expire(26_000)).toBeNull();
  });
});
