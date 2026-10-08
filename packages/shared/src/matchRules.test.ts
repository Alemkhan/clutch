import { describe, expect, it } from 'vitest';
import {
  abandonedAtRound,
  applyMatchRound,
  createMatchRulesState,
  evaluateMatch,
  MIN_POOL_ROUNDS,
  type NormalizedMatchRound,
} from './matchRules';

const questionIds = Array.from({ length: 10 }, (_, index) => `q${index + 1}`);

function rounds(awards: readonly number[]): NormalizedMatchRound[] {
  return roundsFor(questionIds, awards);
}

function roundsFor(ids: readonly string[], awards: readonly number[]): NormalizedMatchRound[] {
  return awards.map((progressAwarded, index) => ({
    questionId: ids[index],
    progressAwarded,
  }));
}

describe('evaluateMatch', () => {
  it('completes a full set below 100 and keeps a losing run ghost-eligible', () => {
    expect(evaluateMatch(questionIds, rounds([5, 5, 5, 5, 5, 5, 5, 5, 5, 5]), rounds([12, 5, 12, 5, 12, 5, 12, 5, 12, 5]))).toEqual({
      roundsPlayed: 10,
      playerProgress: 50,
      opponentProgress: 85,
      status: 'completed',
      outcome: 'opponent',
      ghostEligible: true,
    });
  });

  it('derives completion from a non-standard question-set length', () => {
    const nineQuestionIds = questionIds.slice(0, 9);

    expect(
      evaluateMatch(
        nineQuestionIds,
        roundsFor(nineQuestionIds, Array(9).fill(0)),
        roundsFor(nineQuestionIds, Array(9).fill(5)),
      ),
    ).toMatchObject({
      roundsPlayed: 9,
      playerProgress: 0,
      opponentProgress: 45,
      status: 'completed',
      outcome: 'opponent',
      ghostEligible: true,
    });
  });

  it('makes a player run eligible when it reaches 100 early', () => {
    const result = evaluateMatch(questionIds, rounds([25, 25, 25, 25]), rounds([18, 18, 18, 18, 18]));

    expect(result).toMatchObject({
      roundsPlayed: 4,
      playerProgress: 100,
      opponentProgress: 72,
      status: 'completed',
      outcome: 'player',
      ghostEligible: true,
    });
  });

  it('completes an early loss without making the player ghost-eligible', () => {
    const result = evaluateMatch(questionIds, rounds([12, 12, 12, 12]), rounds([25, 25, 25, 25]));

    expect(result).toMatchObject({
      playerProgress: 48,
      opponentProgress: 100,
      status: 'completed',
      outcome: 'opponent',
      ghostEligible: false,
    });
  });

  it('allows an opponent record to end early at 100', () => {
    expect(() =>
      evaluateMatch(questionIds, rounds([12, 12, 12, 12]), rounds([25, 25, 25, 25])),
    ).not.toThrow();
  });

  it('returns a tie when both players reach 100 in the same round', () => {
    expect(evaluateMatch(questionIds, rounds([25, 25, 25, 25]), rounds([25, 25, 25, 25]))).toMatchObject({
      playerProgress: 100,
      opponentProgress: 100,
      outcome: 'tie',
      ghostEligible: true,
    });
  });

  it('returns a tie when the full question set is exhausted equally', () => {
    expect(evaluateMatch(questionIds, rounds(Array(10).fill(5)), rounds(Array(10).fill(5)))).toMatchObject({
      status: 'completed',
      outcome: 'tie',
      ghostEligible: true,
    });
  });

  it('caps overshooting progress before comparing the outcome', () => {
    expect(
      evaluateMatch(
        questionIds,
        rounds([25, 25, 25, 18, 12]),
        rounds([25, 25, 25, 18, 25]),
      ),
    ).toMatchObject({
      playerProgress: 100,
      opponentProgress: 100,
      outcome: 'tie',
    });
  });

  it('keeps empty and partial runs in progress and ineligible', () => {
    expect(evaluateMatch(questionIds, [], rounds(Array(10).fill(5)))).toEqual(createMatchRulesState());
    expect(evaluateMatch(questionIds, rounds([12, 5]), rounds(Array(10).fill(5)))).toEqual({
      roundsPlayed: 2,
      playerProgress: 17,
      opponentProgress: 10,
      status: 'in_progress',
      ghostEligible: false,
    });
  });

  it.each([
    ['wrong player id', [{ questionId: 'wrong', progressAwarded: 5 }], rounds([5])],
    ['skipped player id', [{ questionId: 'q2', progressAwarded: 5 }], rounds([5])],
    ['wrong opponent id', rounds([5]), [{ questionId: 'q2', progressAwarded: 5 }]],
  ])('rejects %s', (_label, player, opponent) => {
    expect(() => evaluateMatch(questionIds, player, opponent)).toThrow(/expected question q1/);
  });

  it('rejects duplicate question ids', () => {
    expect(() => evaluateMatch(['q1', 'q1'], [], [])).toThrow(/must be unique/);
  });

  it('rejects an empty question set or an empty question id', () => {
    expect(() => evaluateMatch([], [], [])).toThrow(/must not be empty/);
    expect(() => evaluateMatch(['q1', ''], [], [])).toThrow(/empty id/);
  });

  it('rejects an out-of-order round after a valid first round', () => {
    expect(() =>
      evaluateMatch(
        questionIds,
        [
          { questionId: 'q1', progressAwarded: 5 },
          { questionId: 'q3', progressAwarded: 5 },
        ],
        rounds([5, 5]),
      ),
    ).toThrow(/expected question q2/);
  });

  it('rejects a transcript longer than the question set', () => {
    expect(() =>
      evaluateMatch(
        ['q1'],
        [
          { questionId: 'q1', progressAwarded: 5 },
          { questionId: 'q2', progressAwarded: 5 },
        ],
        [{ questionId: 'q1', progressAwarded: 5 }],
      ),
    ).toThrow(/more rounds than the question set/);
  });

  it('rejects a missing opponent round instead of treating it as zero', () => {
    expect(() => evaluateMatch(questionIds, rounds([5, 5]), rounds([5]))).toThrow(
      /opponent round is missing for question q2/,
    );
  });

  it('freezes a short opponent instead of inventing zero rounds when allowed', () => {
    const state = evaluateMatch(questionIds, rounds([5, 5, 5]), rounds([25]), { frozenOpponent: true });
    expect(state.opponentProgress).toBe(25);
    expect(state.playerProgress).toBe(15);
    expect(state.status).toBe('in_progress');
  });

  it('lets the player finish a set against a frozen opponent', () => {
    const ids = ['q1', 'q2', 'q3'];
    const state = evaluateMatch(ids, rounds([5, 5, 5]), rounds([25, 25]), { frozenOpponent: true });
    expect(state.status).toBe('completed');
    expect(state.outcome).toBe('opponent');
    expect(state.opponentProgress).toBe(50);
  });

  it('rejects extra player or opponent rounds after terminal progress', () => {
    expect(() => evaluateMatch(questionIds, rounds([100, 5]), rounds([5, 5]))).toThrow(
      /player has an extra round/,
    );
    expect(() => evaluateMatch(questionIds, rounds([5, 5]), rounds([100, 5]))).toThrow(
      /opponent has an extra round/,
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    'rejects invalid progress award %s',
    (progressAwarded) => {
      expect(() =>
        evaluateMatch(
          questionIds,
          [{ questionId: 'q1', progressAwarded }],
          rounds([5]),
        ),
      ).toThrow(/finite non-negative number/);
    },
  );

  it('rejects an invalid opponent progress award', () => {
    expect(() =>
      evaluateMatch(
        questionIds,
        rounds([5]),
        [{ questionId: 'q1', progressAwarded: Number.NaN }],
      ),
    ).toThrow(/opponent progressAwarded must be a finite non-negative number/);
  });
});

describe('applyMatchRound', () => {
  it('returns a new state without mutating its inputs', () => {
    const state = createMatchRulesState();
    const input = {
      expectedQuestionId: 'q1',
      isLastQuestion: false,
      playerRound: { questionId: 'q1', progressAwarded: 25 },
      opponentRound: { questionId: 'q1', progressAwarded: 18 },
    } as const;
    const stateSnapshot = structuredClone(state);
    const inputSnapshot = structuredClone(input);

    const result = applyMatchRound(state, input);

    expect(result).not.toBe(state);
    expect(state).toEqual(stateSnapshot);
    expect(input).toEqual(inputSnapshot);
  });

  it('refuses a round after the match is finished', () => {
    const completed = applyMatchRound(createMatchRulesState(), {
      expectedQuestionId: 'q1',
      isLastQuestion: true,
      playerRound: { questionId: 'q1', progressAwarded: 5 },
      opponentRound: { questionId: 'q1', progressAwarded: 5 },
    });

    expect(() =>
      applyMatchRound(completed, {
        expectedQuestionId: 'q2',
        isLastQuestion: false,
        playerRound: { questionId: 'q2', progressAwarded: 5 },
        opponentRound: { questionId: 'q2', progressAwarded: 5 },
      }),
    ).toThrow(/after the match has completed/);
  });
});

describe('abandonedAtRound', () => {
  const awards = (values: number[]) => values.map((progressAwarded) => ({ progressAwarded }));
  it('reports the last recorded round of a short run below 100', () => {
    expect(abandonedAtRound(awards([25, 0, 5, 0, 0, 5]), 10)).toBe(6);
  });
  it('does not call an early 100 or a full run abandoned', () => {
    expect(abandonedAtRound(awards([25, 25, 25, 25]), 10)).toBeNull();
    expect(abandonedAtRound(awards(Array(10).fill(5)), 10)).toBeNull();
    expect(abandonedAtRound([], 10)).toBeNull();
  });
  it('exposes the pool threshold', () => {
    expect(MIN_POOL_ROUNDS).toBe(3);
  });
});
