import {
  CURRENT_ASYNC_MATCH_CONDITIONS,
  SKILL_REWARDS,
  applyMatchRound,
  pressureStageFromResults,
  scoreHammerDistance,
  type AsyncMatchConditions,
  type MatchRulesState,
  type MiniGameConfig,
  type Opponent,
  type OpponentRound,
  type Question,
  type StartAsyncMatchResponse,
  type SkillResult,
} from '@clutch/shared';

const supportedRewards = new Set<number>(Object.values(SKILL_REWARDS));

function validateQuestions(questions: readonly Question[]): void {
  if (questions.length === 0) throw new Error('Match questions must not be empty.');
  const ids = new Set<string>();
  for (const question of questions) {
    if (!question || typeof question.id !== 'string' || question.id.length === 0 || ids.has(question.id)) {
      throw new Error('Match questions must have unique non-empty ids.');
    }
    if (question.type !== 'multiple_choice'
      || (question.answerType !== 'multiple_choice' && question.answerType !== 'open_answer')
      || typeof question.prompt !== 'string' || !Array.isArray(question.options)) {
      throw new Error('Match contains an invalid question.');
    }
    const optionIds = new Set<string>();
    for (const option of question.options) {
      if (!option || typeof option.id !== 'string' || option.id.length === 0
        || typeof option.text !== 'string' || optionIds.has(option.id)) {
        throw new Error('Match contains an invalid question option.');
      }
      optionIds.add(option.id);
    }
    if (question.answerType === 'multiple_choice' && !optionIds.has(question.correctOptionId)) {
      throw new Error('Match question has no valid correct option.');
    }
    if (question.answerType === 'open_answer'
      && (!Array.isArray(question.correctAnswers) || question.correctAnswers.length === 0
        || question.correctAnswers.some((answer) => typeof answer !== 'string' || answer.length === 0))) {
      throw new Error('Match open question has no valid answer.');
    }
    ids.add(question.id);
  }
}

export function validateMiniGameConfig(value: unknown): MiniGameConfig {
  if (!value || typeof value !== 'object') throw new Error('Mini-game config is missing.');
  const config = value as Record<string, unknown>;
  const current = CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.config;
  const pressure = config.pressure as Record<string, unknown> | undefined;
  if (Object.keys(config).length !== 4
    || config.markerSpeed !== current.markerSpeed
    || config.targetWidth !== current.targetWidth
    || config.perfectWidth !== current.perfectWidth
    || !pressure
    || Object.keys(pressure).length !== 2
    || !Array.isArray(pressure.stageMultipliers)
    || !Array.isArray(pressure.maxTargetOffsets)
    || pressure.stageMultipliers.length !== current.pressure.stageMultipliers.length
    || pressure.maxTargetOffsets.length !== current.pressure.maxTargetOffsets.length
    || pressure.stageMultipliers.some((item, index) => item !== current.pressure.stageMultipliers[index])
    || pressure.maxTargetOffsets.some((item, index) => item !== current.pressure.maxTargetOffsets[index])) {
    throw new Error('Mini-game config is not supported.');
  }
  return current;
}

export function configForServerConditions(conditions: AsyncMatchConditions): MiniGameConfig {
  if (!conditions || conditions.rulesVersion !== CURRENT_ASYNC_MATCH_CONDITIONS.rulesVersion
    || conditions.miniGame?.id !== CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.id) {
    throw new Error('Match conditions are not supported by this client.');
  }
  return validateMiniGameConfig(conditions.miniGame.config);
}

function validateRound(round: OpponentRound): void {
  if (!round || typeof round !== 'object'
    || typeof round.questionId !== 'string'
    || typeof round.correct !== 'boolean'
    || !Number.isFinite(round.responseTimeMs) || round.responseTimeMs < 0
    || !Number.isFinite(round.skillScore) || round.skillScore < 0 || round.skillScore > 1
    || !supportedRewards.has(round.progressAwarded)
    || (!round.correct && round.progressAwarded !== 0)) {
    throw new Error('Opponent transcript contains an invalid round.');
  }
}

function normalizeOpponent(
  opponent: Opponent,
  questions: readonly Question[],
  remapIds: boolean,
): Opponent {
  validateQuestions(questions);
  if (!opponent || typeof opponent.id !== 'string' || opponent.id.length === 0
    || typeof opponent.displayName !== 'string' || opponent.displayName.trim().length === 0
    || !Array.isArray(opponent.rounds)) {
    throw new Error('Opponent transcript is invalid.');
  }
  if (!remapIds && opponent.rounds.length > questions.length) {
    throw new Error('Opponent transcript has more rounds than the question set.');
  }

  const rounds: OpponentRound[] = [];
  let progress = 0;
  for (let index = 0; index < opponent.rounds.length && index < questions.length; index += 1) {
    const round = opponent.rounds[index];
    validateRound(round);
    const questionId = questions[index].id;
    if (!remapIds && round.questionId !== questionId) {
      throw new Error(`Opponent round must use expected question ${questionId}.`);
    }
    rounds.push({ ...round, questionId });
    progress = Math.min(100, progress + round.progressAwarded);
    if (progress === 100) {
      if (!remapIds && index !== opponent.rounds.length - 1) {
        throw new Error('Opponent transcript continues after reaching 100 progress.');
      }
      break;
    }
  }

  if (progress < 100
    && (rounds.length !== questions.length || opponent.rounds.length !== questions.length)) {
    throw new Error('Opponent transcript is too short for this match.');
  }
  return { ...opponent, rounds };
}

export function normalizeScriptedOpponent(
  opponent: Opponent,
  questions: readonly Question[],
): Opponent {
  return normalizeOpponent(opponent, questions, true);
}

export interface NormalizedOnlineMatch {
  matchId: string;
  questions: Question[];
  opponent: Opponent;
  config: MiniGameConfig;
  opponentSource: StartAsyncMatchResponse['opponentSource'];
}

export function normalizeOnlineMatch(match: StartAsyncMatchResponse): NormalizedOnlineMatch {
  if (!match || typeof match.matchId !== 'string' || match.matchId.length === 0
    || !Array.isArray(match.questions)
    || (match.opponentSource !== 'player' && match.opponentSource !== 'bot')) {
    throw new Error('Async match response is invalid.');
  }
  const config = configForServerConditions(match.conditions);
  const opponent = normalizeOpponent(match.opponent, match.questions, false);
  return {
    matchId: match.matchId,
    questions: match.questions,
    opponent,
    config,
    opponentSource: match.opponentSource,
  };
}

export function applyClientRound(
  state: Readonly<MatchRulesState>,
  questions: readonly Question[],
  questionIndex: number,
  playerProgressAwarded: number,
  opponent: Opponent,
): MatchRulesState {
  if (!supportedRewards.has(playerProgressAwarded)) {
    throw new Error('Player progress award is not supported.');
  }
  const question = questions[questionIndex];
  const opponentRound = opponent.rounds[questionIndex];
  if (!question || !opponentRound) throw new Error('Match transcript ended unexpectedly.');
  return applyMatchRound(state, {
    expectedQuestionId: question.id,
    isLastQuestion: questionIndex === questions.length - 1,
    playerRound: { questionId: question.id, progressAwarded: playerProgressAwarded },
    opponentRound: {
      questionId: opponentRound.questionId,
      progressAwarded: opponentRound.progressAwarded,
    },
  });
}

export function scoreSkillDistance(
  distance: number,
  previousResults: readonly SkillResult[] = [],
  config: MiniGameConfig = CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.config,
): {
  result: SkillResult;
  progressAwarded: number;
} {
  if (!Number.isFinite(distance) || distance < 0 || distance > 1) {
    throw new Error('Skill distance is invalid.');
  }
  return scoreHammerDistance(
    distance,
    pressureStageFromResults(previousResults),
    config,
  );
}
