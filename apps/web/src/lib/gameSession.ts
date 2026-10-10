import type {
  AsyncMatchRoundInput,
  CategoryId,
  MatchRulesState,
  MiniGameConfig,
  Opponent,
  Question,
  SkillResult,
  Tournament,
} from '@clutch/shared';
import {
  CURRENT_ASYNC_MATCH_CONDITIONS,
  SKILL_REWARDS,
  createMatchRulesState,
  isAnswerCorrect,
} from '@clutch/shared';
import { applyClientRound, scoreSkillDistance } from './clientMatchRules';
import type { MatchSource } from './matchmaking';

export type Phase = 'home' | 'categories' | 'matchmaking' | 'question' | 'resolution' | 'hammer' | 'result' | 'profile' | 'training' | 'lastStand';

export interface GameState {
  phase: Phase;
  category: CategoryId;
  questions: Question[];
  questionIndex: number;
  rulesState: MatchRulesState;
  lastCorrect: boolean;
  lastSkill: SkillResult | null;
  bestSkill: SkillResult | null;
  correctCount: number;
  selectedOption: string;
  responseTimes: number[];
  skillResults: SkillResult[];
  opponent: Opponent;
  activeVideo: Tournament['video'];
  fixedQuestions?: Question[];
  activeMatchId?: string;
  roundInputs: AsyncMatchRoundInput[];
  miniGameConfig: MiniGameConfig;
  matchSource: MatchSource;
}

export function createInitialGameState(): GameState {
  return {
    phase: 'home',
    category: 'geography',
    questions: [],
    questionIndex: 0,
    rulesState: createMatchRulesState(),
    lastCorrect: false,
    lastSkill: null,
    bestSkill: null,
    correctCount: 0,
    selectedOption: '',
    responseTimes: [],
    skillResults: [],
    opponent: { id: 'contestant_001', displayName: 'Alex', rounds: [] },
    activeVideo: undefined,
    fixedQuestions: undefined,
    activeMatchId: undefined,
    roundInputs: [],
    miniGameConfig: CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.config,
    matchSource: 'local',
  };
}

interface PreparedMatch {
  category: CategoryId;
  questions: Question[];
  opponent: Opponent;
  activeMatchId?: string;
  miniGameConfig?: MiniGameConfig;
  matchSource?: MatchSource;
}

export function createPreparedMatchState(match: PreparedMatch): GameState {
  return {
    ...createInitialGameState(),
    category: match.category,
    questions: match.questions,
    opponent: match.opponent,
    activeMatchId: match.activeMatchId,
    miniGameConfig: match.miniGameConfig ?? CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.config,
    matchSource: match.matchSource ?? 'local',
    phase: 'question',
  };
}

export function createMatchLobbyState(match: PreparedMatch): GameState {
  return { ...createPreparedMatchState(match), phase: 'matchmaking' };
}

interface ChallengeLobby {
  questions: Question[];
  opponent: Opponent;
  activeVideo: Tournament['video'];
  miniGameConfig: MiniGameConfig;
}

export function createChallengeLobbyState(challenge: ChallengeLobby): GameState {
  const questionCategory = challenge.questions[0]?.category;
  return {
    ...createInitialGameState(),
    category: questionCategory === 'history' || questionCategory === 'languages'
      ? questionCategory
      : 'geography',
    opponent: challenge.opponent,
    activeVideo: challenge.activeVideo,
    fixedQuestions: challenge.questions,
    miniGameConfig: challenge.miniGameConfig,
    matchSource: 'challenge',
    phase: 'matchmaking',
  };
}

export function createChallengeReplayState(state: Readonly<GameState>): GameState {
  if (!state.fixedQuestions || state.fixedQuestions.length === 0) {
    throw new Error('Challenge replay requires fixed questions.');
  }
  return {
    ...createInitialGameState(),
    category: state.category,
    opponent: state.opponent,
    activeVideo: state.activeVideo,
    fixedQuestions: state.fixedQuestions,
    miniGameConfig: state.miniGameConfig,
    questions: state.fixedQuestions,
    matchSource: 'challenge',
    phase: 'matchmaking',
  };
}

export function recordAnswer(
  state: Readonly<GameState>,
  selectedOption: string,
  responseTimeMs: number,
): GameState {
  const question = state.questions[state.questionIndex];
  const correct = question?.answerType === 'open_answer'
    ? isAnswerCorrect(selectedOption, question.correctAnswers ?? []).correct
    : Boolean(question && selectedOption === question.correctOptionId);

  return {
    ...state,
    selectedOption,
    lastCorrect: correct,
    correctCount: correct ? state.correctCount + 1 : state.correctCount,
    responseTimes: [...state.responseTimes, responseTimeMs],
    phase: 'resolution',
  };
}

function currentRoundInput(
  state: Readonly<GameState>,
  skillDistance?: number,
): AsyncMatchRoundInput {
  return {
    questionId: state.questions[state.questionIndex].id,
    selectedAnswer: state.selectedOption,
    responseTimeMs: state.responseTimes[state.responseTimes.length - 1] ?? 0,
    ...(skillDistance === undefined ? {} : { skillDistance }),
  };
}

export function continueAfterAnswerResolution(state: Readonly<GameState>): GameState {
  if (state.lastCorrect) return { ...state, phase: 'hammer' };

  const rulesState = applyClientRound(
    state.rulesState,
    state.questions,
    state.questionIndex,
    0,
    state.opponent,
  );
  const roundInputs = [...state.roundInputs, currentRoundInput(state)];

  return {
    ...state,
    rulesState,
    roundInputs,
    questionIndex: rulesState.status === 'completed'
      ? state.questionIndex
      : state.questionIndex + 1,
    phase: rulesState.status === 'completed' ? 'result' : 'question',
  };
}

export function completeSkillDistance(
  state: Readonly<GameState>,
  distance: number,
): GameState {
  const scored = scoreSkillDistance(distance, state.skillResults, state.miniGameConfig);
  const bestSkill = !state.bestSkill || scored.progressAwarded > SKILL_REWARDS[state.bestSkill]
    ? scored.result
    : state.bestSkill;
  const rulesState = applyClientRound(
    state.rulesState,
    state.questions,
    state.questionIndex,
    scored.progressAwarded,
    state.opponent,
  );

  return {
    ...state,
    rulesState,
    lastSkill: scored.result,
    bestSkill,
    skillResults: [...state.skillResults, scored.result],
    roundInputs: [...state.roundInputs, currentRoundInput(state, distance)],
    questionIndex: rulesState.status === 'completed'
      ? state.questionIndex
      : state.questionIndex + 1,
    phase: rulesState.status === 'completed' ? 'result' : 'question',
  };
}
