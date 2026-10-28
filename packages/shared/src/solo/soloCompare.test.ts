import { describe, expect, it } from 'vitest';
import { compareSoloRuns, compareSoloRunsDetailed, invertOutcome, type SoloRunResult } from './soloCompare';

const reached = (overrides: Partial<SoloRunResult> = {}): SoloRunResult => ({
  reachedTarget: true, progress: 100, roundsPlayed: 6, soloScore: 1, tiebreak: null, ...overrides,
});
const missed = (overrides: Partial<SoloRunResult> = {}): SoloRunResult => ({
  reachedTarget: false, progress: 60, roundsPlayed: 20, soloScore: 3, tiebreak: null, ...overrides,
});

describe('compareSoloRuns: both reached the target', () => {
  it('lower soloScore wins, even with more rounds', () => {
    expect(compareSoloRuns(reached({ soloScore: 0.8, roundsPlayed: 8 }), reached({ soloScore: 1, roundsPlayed: 5 }))).toBe('player');
    expect(compareSoloRuns(reached({ soloScore: 1.2 }), reached({ soloScore: 1 }))).toBe('opponent');
  });

  it('equal score: fewer rounds wins', () => {
    expect(compareSoloRuns(reached({ roundsPlayed: 4 }), reached({ roundsPlayed: 6 }))).toBe('player');
    expect(compareSoloRuns(reached({ roundsPlayed: 7 }), reached({ roundsPlayed: 6 }))).toBe('opponent');
  });

  it('equal score and rounds without guesses: a tie (the run duration is not a criterion)', () => {
    // Раньше здесь побеждал более короткий забег; с 2026-10-15 длительности в сравнении нет.
    expect(compareSoloRuns(reached(), reached())).toBe('tie');
  });

  it('equal score and rounds: the guess decides', () => {
    const near = { questionId: 'q1', multiplier: 1.4 };
    const far = { questionId: 'q1', multiplier: 2.8 };
    expect(compareSoloRunsDetailed(reached({ tiebreak: near }), reached({ tiebreak: far })))
      .toEqual({ outcome: 'player', byTiebreak: true });
    expect(compareSoloRuns(reached({ tiebreak: far }), reached({ tiebreak: near }))).toBe('opponent');
    expect(compareSoloRuns(reached({ tiebreak: far }), reached())).toBe('player');
  });

  it('the guess never overrides score or rounds', () => {
    const near = { questionId: 'q1', multiplier: 1 };
    const far = { questionId: 'q1', multiplier: 9 };
    expect(compareSoloRunsDetailed(reached({ soloScore: 0.9, tiebreak: far }), reached({ tiebreak: near })))
      .toEqual({ outcome: 'player', byTiebreak: false });
    expect(compareSoloRuns(reached({ roundsPlayed: 7, tiebreak: near }), reached({ roundsPlayed: 6, tiebreak: far }))).toBe('opponent');
  });

  it('everything equal is a tie', () => {
    expect(compareSoloRuns(reached(), reached())).toBe('tie');
  });

  it('progress is ignored once both reached the target', () => {
    expect(compareSoloRuns(reached({ progress: 100, soloScore: 0.9 }), reached({ progress: 100, soloScore: 1 }))).toBe('player');
  });
});

describe('compareSoloRuns: only one reached the target', () => {
  it('the one who reached wins regardless of score and rounds', () => {
    expect(compareSoloRuns(reached({ soloScore: 3, roundsPlayed: 20 }), missed({ soloScore: 0.1, roundsPlayed: 1 }))).toBe('player');
    expect(compareSoloRuns(missed({ progress: 99 }), reached({ soloScore: 3 }))).toBe('opponent');
  });
});

describe('compareSoloRuns: nobody reached the target', () => {
  it('greater progress wins', () => {
    expect(compareSoloRuns(missed({ progress: 80 }), missed({ progress: 60 }))).toBe('player');
    expect(compareSoloRuns(missed({ progress: 50 }), missed({ progress: 60 }))).toBe('opponent');
  });

  it('equal progress: fewer rounds wins', () => {
    expect(compareSoloRuns(missed({ roundsPlayed: 12 }), missed({ roundsPlayed: 20 }))).toBe('player');
    expect(compareSoloRuns(missed({ roundsPlayed: 20 }), missed({ roundsPlayed: 12 }))).toBe('opponent');
  });

  it('equal progress and rounds is a tie, duration does not matter', () => {
    expect(compareSoloRuns(missed(), missed())).toBe('tie');
  });

  it('equal progress and rounds: the guess decides; equal multipliers or other days stay a tie', () => {
    const near = { questionId: 'q1', multiplier: 1.4 };
    const far = { questionId: 'q1', multiplier: 2.8 };
    expect(compareSoloRunsDetailed(missed({ tiebreak: far }), missed({ tiebreak: near })))
      .toEqual({ outcome: 'opponent', byTiebreak: true });
    expect(compareSoloRunsDetailed(missed({ tiebreak: near }), missed({ tiebreak: { ...near } })))
      .toEqual({ outcome: 'tie', byTiebreak: false });
    expect(compareSoloRuns(missed({ tiebreak: near }), missed({ tiebreak: { questionId: 'q2', multiplier: 9 } }))).toBe('tie');
  });

  it('soloScore does not decide when the target was missed', () => {
    expect(compareSoloRuns(missed({ progress: 70, soloScore: 5 }), missed({ progress: 60, soloScore: 1 }))).toBe('player');
  });
});

describe('compareSoloRuns: symmetry and input checks', () => {
  it('swapping the arguments inverts the outcome', () => {
    const cases: Array<[SoloRunResult, SoloRunResult]> = [
      [reached({ soloScore: 0.8 }), reached()],
      [reached(), missed()],
      [missed({ progress: 70 }), missed()],
      [reached(), reached()],
      [missed(), missed()],
    ];
    for (const [first, second] of cases) {
      expect(compareSoloRuns(second, first)).toBe(invertOutcome(compareSoloRuns(first, second)));
    }
  });

  it('rejects non-finite numbers', () => {
    expect(() => compareSoloRuns(reached({ soloScore: Number.NaN }), reached())).toThrow(RangeError);
    expect(() => compareSoloRuns(reached(), reached({ progress: Number.POSITIVE_INFINITY }))).toThrow(RangeError);
  });
});
