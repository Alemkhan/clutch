import { describe, expect, it } from 'vitest';
import {
  applySoloRound,
  createSoloRunState,
  evaluateSoloRun,
  SOLO_ROUND_CAP,
  SOLO_TARGET_PROGRESS,
  type SoloRunRound,
} from './soloRun';

const ids = Array.from({ length: 30 }, (_, index) => `q${index + 1}`);

function rounds(awards: readonly number[]): SoloRunRound[] {
  return awards.map((progressAwarded, index) => ({ questionId: ids[index], progressAwarded }));
}

describe('evaluateSoloRun', () => {
  it('completes exactly at the target', () => {
    const state = evaluateSoloRun(ids, rounds([25, 25, 25, 25]));
    expect(state).toEqual({ roundsPlayed: 4, progress: 100, status: 'completed', reachedTarget: true });
  });

  it('clamps an overshoot to the target', () => {
    const state = evaluateSoloRun(ids, rounds([60, 60]));
    expect(state.progress).toBe(SOLO_TARGET_PROGRESS);
    expect(state.reachedTarget).toBe(true);
  });

  it('stays in progress below the target', () => {
    const state = evaluateSoloRun(ids, rounds([25, 0, 5]));
    expect(state).toEqual({ roundsPlayed: 3, progress: 30, status: 'in_progress', reachedTarget: false });
  });

  it('stops at the round cap without the target', () => {
    const state = evaluateSoloRun(ids, rounds(Array(SOLO_ROUND_CAP).fill(1)));
    expect(state).toEqual({
      roundsPlayed: SOLO_ROUND_CAP,
      progress: SOLO_ROUND_CAP,
      status: 'completed',
      reachedTarget: false,
    });
  });

  it('completes without the target when questions run out', () => {
    const state = evaluateSoloRun(ids.slice(0, 3), rounds([10, 10, 10]));
    expect(state).toEqual({ roundsPlayed: 3, progress: 30, status: 'completed', reachedTarget: false });
  });

  it('treats an empty set as an already completed run', () => {
    expect(evaluateSoloRun([], [])).toEqual({
      roundsPlayed: 0,
      progress: 0,
      status: 'completed',
      reachedTarget: false,
    });
  });

  it('rejects a round after completion', () => {
    expect(() => evaluateSoloRun(ids, rounds([100, 10]))).toThrow('cannot apply a round after the run has completed');
  });

  it('rejects a mismatched question id', () => {
    const wrong = [{ questionId: 'q9', progressAwarded: 10 }];
    expect(() => evaluateSoloRun(ids, wrong)).toThrow('round must use expected question q1');
  });

  it('rejects more rounds than questions', () => {
    expect(() => evaluateSoloRun(ids.slice(0, 2), rounds([1, 1, 1]))).toThrow('more rounds than the question set');
  });

  it('rejects empty and duplicate question ids', () => {
    expect(() => evaluateSoloRun([''], [])).toThrow('empty id');
    expect(() => evaluateSoloRun(['a', 'a'], [])).toThrow('unique');
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rejects progressAwarded %s with RangeError', (value) => {
    expect(() => evaluateSoloRun(ids, [{ questionId: 'q1', progressAwarded: value }])).toThrow(RangeError);
  });
});

describe('applySoloRound', () => {
  it('does not mutate the previous state', () => {
    const state = createSoloRunState();
    const next = applySoloRound(state, { expectedQuestionId: 'q1', round: { questionId: 'q1', progressAwarded: 25 } });
    expect(state).toEqual(createSoloRunState());
    expect(next.progress).toBe(25);
  });
});
