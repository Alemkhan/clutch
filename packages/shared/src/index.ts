import type { MiniGameConfig, SkillResult } from './hammerRules';
import type { PracticeLevelId } from './practice';

export type AnswerType = 'multiple_choice' | 'open_answer';

export * from './fuzzyMatch';
export * from './hammerRules';
export * from './matchRules';
export * from './soloRun';
export * from './questionPricing';
export * from './soloCompare';
export * from './practice';
export * from './friendDuel';

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
  /** One-time rematch invite id (the part after "rm_" is random); checked against the caller on the server. */
  rematchInviteId?: string;
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
  /** true: игрок прошёл все наборы дня в категории, выдан наименее давно сыгранный. */
  bankExhausted: boolean;
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

/** Соло-забег: тело старта без реванш-приглашения (сервер его отклоняет). */
export interface StartSoloRunRequest {
  displayName: string;
  category: 'geography' | 'history' | 'languages';
  /** Одноразовое приглашение на соло-реванш; сервер сверяет его с игроком. */
  rematchInviteId?: string;
  /** Тренировка: уровень бота. Забег не идёт в соревнование; с реваншем не сочетается. */
  botLevel?: PracticeLevelId;
}

export interface StartSoloRunResponse {
  runId: string;
  questions: Question[];
  /** Только темп для отрисовки; забег он не завершает. null — записи нет. */
  pace: Opponent | null;
  target: number;
  roundCap: number;
  rulesVersion: string;
  /** true: все наборы дня в категории уже пройдены, выдан наименее давно сыгранный. */
  bankExhausted: boolean;
}

export type CompleteSoloRunRequest = CompleteAsyncMatchRequest;

/** «Позвать друга»: готовая ссылка на открытое приглашение по записи своего завершённого забега. */
export interface CreateFriendInviteResponse {
  inviteId: string;
  url: string;
  expiresAt: number;
}

export interface CompleteSoloRunResponse {
  runId: string;
  rounds: AsyncMatchRound[];
  progress: number;
  correctCount: number;
  roundsPlayed: number;
  reachedTarget: boolean;
  par: number;
  score: number;
  /** Исход против темпа глазами игрока. null — темпа не было, забег ждёт соперника (это не ничья). */
  outcome: MyRunOutcome | null;
}

/** Исход партии глазами игрока: победа, поражение или ничья. */
export type MyRunOutcome = 'player' | 'opponent' | 'tie';

/** Одна завершённая партия игрока в «Моих партиях». */
export interface MyRunSummary {
  runId: string;
  category: 'geography' | 'history' | 'languages';
  mode: 'race' | 'solo';
  roundsPlayed: number;
  progress: number;
  correctCount: number;
  /** null у гонки: цель достигается там же, где и победа, отдельного признака нет. */
  reachedTarget: boolean | null;
  /** Только у соло-забега. */
  setPar: number | null;
  soloScore: number | null;
  startedAt: number;
  completedAt: number;
  /** С кем сравнивался: запись игрока, бот либо никого (соло без темпа). */
  opponent: { kind: 'player' | 'bot'; displayName: string } | null;
  /** null: соло без соперника (ждёт его, opponent === null) либо исход не удалось определить. Ничья — 'tie'. */
  outcome: MyRunOutcome | null;
  /**
   * Дружеская дуэль, не в зачёт: 'played' — игрок играл по ссылке; 'hosted' — друг сыграл его запись
   * (цифры тогда друга, а исход дан глазами владельца записи). Обычная партия — null.
   */
  friendDuel?: 'played' | 'hosted' | null;
}

/** Активное приглашение на реванш, адресованное игроку. */
export interface MyRematchInvite {
  inviteId: string;
  category: 'geography' | 'history' | 'languages';
  challengerName: string;
  challengerProgress: number;
  yourProgress: number;
  expiresAt: number;
}

export interface MyRunsResponse {
  runs: MyRunSummary[];
  /** Значение для `before` следующей страницы; null — партий больше нет. */
  nextCursor: string | null;
  invites: MyRematchInvite[];
}

export interface Opponent {
  id: string;
  displayName: string;
  avatar?: string;
  rounds: OpponentRound[];
}

export interface AsyncMatchConditions {
  rulesVersion: string;
  miniGame: {
    id: 'hammer_nail';
    config: MiniGameConfig;
  };
}

export const CURRENT_ASYNC_MATCH_CONDITIONS: AsyncMatchConditions = {
  rulesVersion: 'race-to-100-v2',
  miniGame: {
    id: 'hammer_nail',
    config: {
      markerSpeed: 0.8,
      targetWidth: 0.85,
      perfectWidth: 0.15,
      pressure: {
        stageMultipliers: [1, 0.9, 0.8, 0.7],
        maxTargetOffsets: [0.06, 0.09, 0.12, 0.15],
      },
    },
  },
};

/** Соло-забег до цели: та же схема и тот же молоток, своя версия правил (гоночные записи в соло-пул не попадают). */
export const CURRENT_SOLO_RUN_CONDITIONS: AsyncMatchConditions = {
  rulesVersion: 'solo-to-100-v1',
  miniGame: CURRENT_ASYNC_MATCH_CONDITIONS.miniGame,
};

export * from './countries';
export * from './flagTraits';
export * from './historicFlags';
export * from './languages';
export * from './narrowCategories';
export * from './questionGenerator';
export * from './dailyQuestionSet';
export * from './lastStand';
