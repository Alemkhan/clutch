import { describe, expect, it } from 'vitest';
import {
  createQuestionTiming,
  displayedQuestionSecond,
  nextCountdownTick,
  QuestionSubmissionGate,
  remainingQuestionMs,
} from './questionTiming';

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
