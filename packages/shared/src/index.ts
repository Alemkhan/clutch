import { SKILL_DISTANCE_THRESHOLDS, type MiniGameConfig, type SkillResult } from './hammerRules';
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

/**
 * Вопрос в том виде, в каком он уходит в браузер: только то, что нужно показать.
 * Нет correctOptionId, correctAnswers и пояснения (оно называет ответ), нет источников.
 */
export type PublicQuestion = Pick<
  Question,
  'id' | 'type' | 'answerType' | 'category' | 'subcategory' | 'difficulty' | 'prompt'
  | 'options' | 'mediaType' | 'mediaUrl' | 'mediaText'
>;

/** Белый список полей: новое поле вопроса не попадёт клиенту, пока его не добавят сюда осознанно. */
export function toPublicQuestion(question: Question): PublicQuestion {
  return {
    id: question.id,
    type: question.type,
    answerType: question.answerType,
    category: question.category,
    ...(question.subcategory === undefined ? {} : { subcategory: question.subcategory }),
    difficulty: question.difficulty,
    prompt: question.prompt,
    options: question.options.map((option) => ({ id: option.id, text: option.text })),
    ...(question.mediaType === undefined ? {} : { mediaType: question.mediaType }),
    ...(question.mediaUrl === undefined ? {} : { mediaUrl: question.mediaUrl }),
    ...(question.mediaText === undefined ? {} : { mediaText: question.mediaText }),
  };
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
  /** Без ответов и пояснений: правильный ответ приходит только после сыгранного круга. */
  questions: PublicQuestion[];
  /** Только темп для отрисовки; забег он не завершает. null — записи нет. */
  pace: Opponent | null;
  target: number;
  roundCap: number;
  rulesVersion: string;
  /** true: все наборы дня в категории уже пройдены, выдан наименее давно сыгранный. */
  bankExhausted: boolean;
}


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

/** Ответ игрока на вопрос круга. roundIndex с нуля; повтор того же круга сервер не считает дважды. */
export interface SoloAnswerRequest {
  roundIndex: number;
  questionId: string;
  selectedAnswer: string;
  responseTimeMs: number;
}

/** Удар молотка по верному ответу. skillDistance измеряет устройство: сервер ему верит в пределах 0..1. */
export interface SoloHammerRequest {
  roundIndex: number;
  questionId: string;
  skillDistance: number;
}

/**
 * Итог круга от сервера: верность, награда, прогресс и правильный ответ — уже после проверки.
 * awaitingHammer: ответ верен, ждём удар; круг ещё не закрыт и прогресс не изменился.
 */
export interface SoloRoundResponse {
  runId: string;
  roundIndex: number;
  questionId: string;
  correct: boolean;
  /** Только у вопроса с вариантами. */
  correctOptionId?: string;
  /** Только у открытого вопроса. */
  correctAnswers?: string[];
  explanation: string;
  awaitingHammer: boolean;
  skillResult: SkillResult | null;
  progressAwarded: number;
  /** Прогресс забега после этого круга (пока ждём удар — до него). */
  progress: number;
  roundsPlayed: number;
  status: 'in_progress' | 'completed';
  reachedTarget: boolean;
  /** Итог забега; есть, только когда этот круг его закрыл. */
  result: CompleteSoloRunResponse | null;
}

export interface SoloPlayedRound {
  questionId: string;
  correct: boolean;
  skillResult: SkillResult | null;
  progressAwarded: number;
  responseTimeMs: number;
}

/** Состояние забега для продолжения после закрытой вкладки. Незакрытый удар сервер засчитывает промахом. */
export interface SoloRunSnapshot extends StartSoloRunResponse {
  category: 'geography' | 'history' | 'languages';
  rounds: SoloPlayedRound[];
  status: 'in_progress' | 'completed';
  result: CompleteSoloRunResponse | null;
}

/** Отработка ошибок: клиент хранит id, вопросы и проверку получает от сервера. */
export interface TrainingQuestionsRequest {
  ids: string[];
}

export interface TrainingQuestionsResponse {
  questions: PublicQuestion[];
  /** Id, из которых вопрос больше не собрать: клиент убирает их из своего списка. */
  unknownIds: string[];
}

/** Для вопроса с вариантами answer — ТЕКСТ выбранного варианта: варианты каждый раз собираются заново. */
export interface TrainingCheckRequest {
  questionId: string;
  answer: string;
}

export interface TrainingCheckResponse {
  correct: boolean;
  correctText?: string;
  correctAnswers?: string[];
  explanation: string;
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
  rulesVersion: 'race-to-100-v3',
  miniGame: {
    id: 'hammer_nail',
    config: {
      markerSpeedMin: 0.6,
      markerSpeedMax: 1.6,
      targetWidth: 0.85,
      perfectWidth: SKILL_DISTANCE_THRESHOLDS.perfect,
      pressure: {
        stageMultipliers: [1, 0.9, 0.8, 0.7],
        maxTargetOffsets: [0.06, 0.09, 0.12, 0.15],
      },
    },
  },
};

/** Соло-забег до цели: та же схема и тот же молоток, своя версия правил (гоночные записи в соло-пул не попадают). */
export const CURRENT_SOLO_RUN_CONDITIONS: AsyncMatchConditions = {
  rulesVersion: 'solo-to-100-v2',
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
