export type SkillResult = 'perfect' | 'great' | 'good' | 'weak' | 'miss';

export type Difficulty = 'Easy' | 'Medium' | 'Hard' | 'Expert';

export interface QuestionOption {
  id: string;
  text: string;
}

export interface Question {
  id: string;
  type: 'multiple_choice';
  category: string;
  subcategory?: string;
  difficulty: Difficulty;
  prompt: string;
  options: QuestionOption[];
  correctOptionId: string;
  explanation: string;
  sourceUrl?: string;
  sourceTitle?: string;
  media?: string | null;
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
  if (d <= 1.0) return 'weak';
  return 'miss';
}
