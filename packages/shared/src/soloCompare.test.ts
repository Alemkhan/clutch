import { describe, expect, it } from 'vitest';
import { compareSoloRuns, invertOutcome, type SoloRunResult } from './soloCompare';

const reached = (overrides: Partial<SoloRunResult> = {}): SoloRunResult => ({
  reachedTarget: true, progress: 100, roundsPlayed: 6, soloScore: 1, durationMs: 60_000, ...overrides,
});
const missed = (overrides: Partial<SoloRunResult> = {}): SoloRunResult => ({
  reachedTarget: false, progress: 60, roundsPlayed: 20, soloScore: 3, durationMs: 60_000, ...overrides,
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

  it('equal score and rounds: shorter run duration wins', () => {
    expect(compareSoloRuns(reached({ durationMs: 40_000 }), reached({ durationMs: 90_000 }))).toBe('player');
    expect(compareSoloRuns(reached({ durationMs: 90_000 }), reached({ durationMs: 40_000 }))).toBe('opponent');
  });

  it('duration only breaks a tie: score and rounds come first', () => {
    expect(compareSoloRuns(reached({ soloScore: 0.9, durationMs: 900_000 }), reached({ durationMs: 1 }))).toBe('player');
    expect(compareSoloRuns(reached({ roundsPlayed: 7, durationMs: 1 }), reached({ roundsPlayed: 6, durationMs: 900_000 }))).toBe('opponent');
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
    expect(compareSoloRuns(missed({ durationMs: 1 }), missed({ durationMs: 999_000 }))).toBe('tie');
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
    expect(() => compareSoloRuns(reached(), reached({ durationMs: Number.POSITIVE_INFINITY }))).toThrow(RangeError);
  });

  it('rejects a negative or non-numeric duration', () => {
    expect(() => compareSoloRuns(reached({ durationMs: -1 }), reached())).toThrow(RangeError);
    expect(() => compareSoloRuns(reached(), missed({ durationMs: -5 }))).toThrow(RangeError);
    expect(() => compareSoloRuns(reached({ durationMs: Number.NaN }), reached())).toThrow(RangeError);
    expect(() => compareSoloRuns(reached({ durationMs: '5' as unknown as number }), reached())).toThrow(RangeError);
  });
});
