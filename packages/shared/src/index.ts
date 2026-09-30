export type AnswerType = 'multiple_choice' | 'open_answer';

export * from './fuzzyMatch';
export * from './matchRules';

export type SkillResult = 'perfect' | 'great' | 'good' | 'weak' | 'miss';

export type Difficulty = 'Easy' | 'Medium' | 'Hard' | 'Expert';

export interface QuestionOption {
  id: string;
  text: string;
}

export interface Question {
  id: string;
  type: 'multiple_choice';
  answerType: AnswerType;
  category: string;
  subcategory?: string;
  difficulty: Difficulty;
  prompt: string;
  options: QuestionOption[];
  correctOptionId: string;
  correctAnswers?: string[];
  explanation: string;
  sourceUrl?: string;
  sourceTitle?: string;
  mediaType?: 'flag' | 'outline' | null;
  mediaUrl?: string | null;
  mediaText?: string | null;
  status: 'draft' | 'approved';
  createdAt: string;
  lastVerifiedAt?: string;
}

export interface OpponentRound {
  questionId: string;
  correct: boolean;
  responseTimeMs: number;
  skillScore: number;
  progressAwarded: number;
}

export interface AsyncMatchRoundInput {
  questionId: string;
  selectedAnswer: string;
  responseTimeMs: number;
  skillDistance?: number;
}

export interface AsyncMatchRound {
  questionId: string;
  correct: boolean;
  responseTimeMs: number;
  skillResult?: SkillResult;
  progressAwarded: number;
  playerProgressAfter: number;
}

export interface StartAsyncMatchRequest {
  displayName: string;
  category: 'geography' | 'history' | 'languages';
}

export interface GuestSessionResponse {
  token: string;
  expiresAt: number;
}

export interface StartAsyncMatchResponse {
  matchId: string;
  questions: Question[];
  opponent: Opponent;
  opponentSource: 'player' | 'bot';
  conditions: AsyncMatchConditions;
}

export interface CompleteAsyncMatchRequest {
  rounds: AsyncMatchRoundInput[];
}

export interface CompleteAsyncMatchResponse {
  matchId: string;
  rounds: AsyncMatchRound[];
  playerProgress: number;
  correctCount: number;
}

export interface Opponent {
  id: string;
  displayName: string;
  avatar?: string;
  rounds: OpponentRound[];
}

export interface MiniGameConfig {
  markerSpeed: number;
  targetWidth: number;
  perfectWidth: number;
}

export interface AsyncMatchConditions {
  rulesVersion: string;
  miniGame: {
    id: 'hammer_nail';
    config: MiniGameConfig;
  };
}

export const CURRENT_ASYNC_MATCH_CONDITIONS: AsyncMatchConditions = {
  rulesVersion: 'race-to-100-v1',
  miniGame: {
    id: 'hammer_nail',
    config: {
      markerSpeed: 0.8,
      targetWidth: 0.85,
      perfectWidth: 0.15,
    },
  },
};

export interface Tournament {
  id: string;
  slug: string;
  title: string;
  description: string;
  status: 'draft' | 'published';
  publishAt?: string;
  questionIds: string[];
  opponentId: string;
  miniGame: {
    id: 'hammer_nail';
    config: MiniGameConfig;
  };
  rankingEnabled: boolean;
  video?: {
    platform: string;
    url: string;
    contentId: string;
  };
}

export interface SkillAttempt {
  questionId: string;
  result: SkillResult;
  progressAwarded: number;
  distance: number;
}

export interface MatchRound {
  questionId: string;
  selectedOptionId?: string;
  correct: boolean;
  responseTimeMs: number;
  skillAttempt?: SkillAttempt;
  playerProgressAfter: number;
  opponentProgressAfter: number;
}

export interface Match {
  id: string;
  tournamentId: string;
  playerProgress: number;
  opponentProgress: number;
  rounds: MatchRound[];
  status: 'in_progress' | 'completed';
  winner?: 'player' | 'opponent' | 'tie';
  startedAt: string;
  completedAt?: string;
}

export const SKILL_REWARDS: Record<SkillResult, number> = {
  perfect: 25,
  great: 18,
  good: 12,
  weak: 5,
  miss: 0,
};

/** Maximum normalized distance from the centre for each non-miss tier. */
export const SKILL_DISTANCE_THRESHOLDS = {
  perfect: 0.15,
  great: 0.35,
  good: 0.65,
  weak: 0.85,
} as const;

export function resultFromDistance(d: number): SkillResult {
  if (d <= SKILL_DISTANCE_THRESHOLDS.perfect) return 'perfect';
  if (d <= SKILL_DISTANCE_THRESHOLDS.great) return 'great';
  if (d <= SKILL_DISTANCE_THRESHOLDS.good) return 'good';
  if (d <= SKILL_DISTANCE_THRESHOLDS.weak) return 'weak';
  return 'miss';
}

export * from './countries';
export * from './flagTraits';
export * from './historicFlags';
export * from './languages';
export * from './questionGenerator';
