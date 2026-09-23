export type AnswerType = 'multiple_choice' | 'open_answer';

export * from './fuzzyMatch';

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
  playerId: string;
  displayName: string;
  category: 'geography' | 'history' | 'languages';
  telegramInitData?: string;
}

export interface StartAsyncMatchResponse {
  matchId: string;
  questions: Question[];
  opponent: Opponent;
  opponentSource: 'player' | 'bot';
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

export function resultFromDistance(d: number): SkillResult {
  if (d <= 0.15) return 'perfect';
  if (d <= 0.35) return 'great';
  if (d <= 0.65) return 'good';
  if (d <= 0.85) return 'weak';
  return 'miss';
}

export * from './countries';
export * from './flagTraits';
export * from './historicFlags';
export * from './languages';
export * from './questionGenerator';
