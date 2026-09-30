export interface NormalizedMatchRound {
  questionId: string;
  progressAwarded: number;
}

export type MatchOutcome = 'player' | 'opponent' | 'tie';

export interface MatchRulesState {
  roundsPlayed: number;
  playerProgress: number;
  opponentProgress: number;
  status: 'in_progress' | 'completed';
  outcome?: MatchOutcome;
  ghostEligible: boolean;
}

export interface ApplyMatchRoundInput {
  expectedQuestionId: string;
  isLastQuestion: boolean;
  playerRound: NormalizedMatchRound;
  opponentRound: NormalizedMatchRound;
}

const MAX_PROGRESS = 100;

export function createMatchRulesState(): MatchRulesState {
  return {
    roundsPlayed: 0,
    playerProgress: 0,
    opponentProgress: 0,
    status: 'in_progress',
    ghostEligible: false,
  };
}

function assertValidAward(round: NormalizedMatchRound, side: 'player' | 'opponent'): void {
  if (!Number.isFinite(round.progressAwarded) || round.progressAwarded < 0) {
    throw new RangeError(`${side} progressAwarded must be a finite non-negative number`);
  }
}

/**
 * Applies one already-scored round without mutating the previous state.
 *
 * `progressAwarded` is a normalized rules input, not authoritative client data.
 * A server must derive it from trusted questions and scoring separately; this
 * module does not provide authentication or anti-cheat checks. The state must
 * come from these helpers, while `expectedQuestionId` and `isLastQuestion` must
 * be derived from the authoritative ordered question set, not client payload.
 */
export function applyMatchRound(
  state: Readonly<MatchRulesState>,
  input: Readonly<ApplyMatchRoundInput>,
): MatchRulesState {
  if (state.status === 'completed') {
    throw new Error('cannot apply a round after the match has completed');
  }

  if (input.playerRound.questionId !== input.expectedQuestionId) {
    throw new Error(`player round must use expected question ${input.expectedQuestionId}`);
  }
  if (input.opponentRound.questionId !== input.expectedQuestionId) {
    throw new Error(`opponent round must use expected question ${input.expectedQuestionId}`);
  }

  assertValidAward(input.playerRound, 'player');
  assertValidAward(input.opponentRound, 'opponent');

  const playerProgress = Math.min(
    MAX_PROGRESS,
    state.playerProgress + input.playerRound.progressAwarded,
  );
  const opponentProgress = Math.min(
    MAX_PROGRESS,
    state.opponentProgress + input.opponentRound.progressAwarded,
  );
  const completed =
    playerProgress === MAX_PROGRESS || opponentProgress === MAX_PROGRESS || input.isLastQuestion;

  if (!completed) {
    return {
      roundsPlayed: state.roundsPlayed + 1,
      playerProgress,
      opponentProgress,
      status: 'in_progress',
      ghostEligible: false,
    };
  }

  const outcome: MatchOutcome =
    playerProgress === opponentProgress
      ? 'tie'
      : playerProgress > opponentProgress
        ? 'player'
        : 'opponent';

  return {
    roundsPlayed: state.roundsPlayed + 1,
    playerProgress,
    opponentProgress,
    status: 'completed',
    outcome,
    ghostEligible: input.isLastQuestion || playerProgress === MAX_PROGRESS,
  };
}

function assertQuestionIds(questionIds: readonly string[]): void {
  if (questionIds.length === 0) {
    throw new Error('questionIds must not be empty');
  }

  const uniqueIds = new Set<string>();
  for (const questionId of questionIds) {
    if (questionId.length === 0) {
      throw new Error('questionIds must not contain an empty id');
    }
    if (uniqueIds.has(questionId)) {
      throw new Error(`questionIds must be unique: ${questionId}`);
    }
    uniqueIds.add(questionId);
  }
}

function assertOrderedRun(
  side: 'player' | 'opponent',
  questionIds: readonly string[],
  rounds: readonly NormalizedMatchRound[],
): void {
  if (rounds.length > questionIds.length) {
    throw new Error(`${side} has more rounds than the question set`);
  }

  let progress = 0;
  for (let index = 0; index < rounds.length; index += 1) {
    const round = rounds[index];
    const expectedQuestionId = questionIds[index];
    if (round.questionId !== expectedQuestionId) {
      throw new Error(`${side} round must use expected question ${expectedQuestionId}`);
    }
    assertValidAward(round, side);

    if (progress === MAX_PROGRESS) {
      throw new Error(`${side} has an extra round after reaching 100 progress`);
    }
    progress = Math.min(MAX_PROGRESS, progress + round.progressAwarded);
  }
}

/**
 * Validates and evaluates the player's played prefix against a normalized
 * opponent transcript. This does not validate an HTTP schema or decide whether
 * an incomplete opponent transcript is eligible for a persisted opponent pool.
 */
export function evaluateMatch(
  questionIds: readonly string[],
  playerRounds: readonly NormalizedMatchRound[],
  opponentRounds: readonly NormalizedMatchRound[],
): MatchRulesState {
  assertQuestionIds(questionIds);
  assertOrderedRun('player', questionIds, playerRounds);
  assertOrderedRun('opponent', questionIds, opponentRounds);

  let state = createMatchRulesState();
  for (let index = 0; index < playerRounds.length; index += 1) {
    const opponentRound = opponentRounds[index];
    if (opponentRound === undefined) {
      throw new Error(`opponent round is missing for question ${questionIds[index]}`);
    }

    state = applyMatchRound(state, {
      expectedQuestionId: questionIds[index],
      isLastQuestion: index === questionIds.length - 1,
      playerRound: playerRounds[index],
      opponentRound,
    });
  }

  return state;
}
