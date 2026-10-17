import { SKILL_DISTANCE_THRESHOLDS, type MiniGameConfig, type SkillResult } from './hammerRules';
import type { PracticeLevelId } from './practice';

/** Категория вопросов. Единственное объявление; questionGenerator его ре-экспортирует. */
export type CategoryId = 'general' | 'geography' | 'history' | 'languages';

export type AnswerType = 'multiple_choice' | 'open_answer';

export * from './fuzzyMatch';
export * from './hammerRules';
export * from './soloRun';
export * from './questionPricing';
export * from './soloCompare';
export * from './practice';
export * from './friendDuel';
export * from './tiebreaker';

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
  /** Момент удара, а не его качество: расстояние до цели выводит сервер. */
  activeElapsedMs?: number;
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
  category: CategoryId;
  /** One-time rematch invite id (the part after "rm_" is random); checked against the caller on the server. */
  rematchInviteId?: string;
}

export interface GuestSessionResponse {
  token: string;
  expiresAt: number;
}

/** Соло-забег: тело старта без реванш-приглашения (сервер его отклоняет). */
export interface StartSoloRunRequest {
  displayName: string;
  category: CategoryId;
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
  /** Мини-игра этого забега: выбрана сервером при старте (или унаследована от записи соперника). */
  miniGameId: MiniGameId;
  /** true: все наборы дня в категории уже пройдены, выдан наименее давно сыгранный. */
  bankExhausted: boolean;
  /**
   * true: незаконченный забег продолжен, а не создан. Тело — снимок (`SoloRunSnapshot`:
   * `rounds`, `status`, `category`...), клиент входит в него так же, как при восстановлении.
   */
  resumed?: true;
}


/** «Позвать друга»: готовая ссылка на открытое приглашение по записи своего завершённого забега. */
export interface CreateFriendInviteResponse {
  inviteId: string;
  url: string;
  expiresAt: number;
}

/** POST /api/share/prepared: id подготовленного сообщения для Telegram shareMessage. */
export interface PreparedShareResponse {
  id: string;
}

/**
 * Итог нажатия «Позвать на реванш». Ссылки здесь нет: приглашение адресное, и его уносит
 * сообщение бота владельцу обойдённой записи, а не share с экрана звавшего.
 */
export interface CreateRematchInviteResponse {
  inviteId: string;
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
  /**
   * Есть, только когда исход решила прикидка «На глазок» (счёт/круги/прогресс равны). Множитель
   * соперника — только если игрок сам ответил: число не подсказывают тем, кто ещё не отвечал.
   * Повтор completion и снимок забега поля не несут: восстановить его нечем без новых колонок.
   */
  tiebreak?: { ownMultiplier: number | null; opponentMultiplier: number | null };
}

/** Ответ игрока на вопрос круга. roundIndex с нуля; повтор того же круга сервер не считает дважды. */
export interface SoloAnswerRequest {
  roundIndex: number;
  questionId: string;
  selectedAnswer: string;
  responseTimeMs: number;
  /**
   * Диагностика (необязательна): что игрок видел на кнопке. Верность по ним НЕ считается; сервер
   * лишь сверяет текст с вариантом `selectedAnswer` и пишет событие `answer_option_mismatch`.
   */
  selectedText?: string;
  optionCount?: number;
  firstOptionId?: string;
}

/**
 * Удар молотка по верному ответу. Устройство сообщает только **момент** удара — активное время
 * от старта маркера; расстояние до цели и награду считает сервер (`scoreHammerTap`).
 */
export interface SoloHammerRequest {
  roundIndex: number;
  questionId: string;
  activeElapsedMs: number;
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
  /**
   * Только у вопроса с вариантами: вариант, который сервер записал на этот круг. Обычно это выбор
   * игрока, но при повторе с другого экрана записан первый; разбор показывает именно его.
   */
  selectedAnswer?: string;
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
  category: CategoryId;
  /** Соперник отпущен, пока игрока не было: забег продолжается как одиночный. */
  paceReleased?: boolean;
  rounds: SoloPlayedRound[];
  status: 'in_progress' | 'completed';
  result: CompleteSoloRunResponse | null;
}

/** Отработка ошибок: журнал ведёт сервер; клиент получает id сессии, затем вопросы и проверку. */
export interface TrainingMistakesResponse {
  /** Сколько ошибок сейчас можно отработать. */
  count: number;
  /** Id следующей сессии по приоритету. */
  ids: string[];
}

export interface TrainingQuestionsRequest {
  ids: string[];
}

export interface TrainingQuestionsResponse {
  questions: PublicQuestion[];
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
  category: CategoryId;
  roundsPlayed: number;
  progress: number;
  correctCount: number;
  reachedTarget: boolean;
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
  /**
   * Реванш зовёт игрок, а не система. 'available' — этот забег сыгран против записи человека (любой исход), и её владельца
   * можно позвать; 'sent' — уже позвал; null — звать некого.
   */
  rematchOffer?: 'available' | 'sent' | null;
  /**
   * Круги соперника: его запись либо тот, кто сыграл твою. null — у бота, у чужой дружеской
   * дуэли и у старых данных. Поле опционально: ответ старого сервера его не несёт.
   */
  opponentRoundsPlayed?: number | null;
}

/** Активное приглашение на реванш, адресованное игроку. */
export interface MyRematchInvite {
  inviteId: string;
  category: CategoryId;
  challengerName: string;
  challengerProgress: number;
  yourProgress: number;
  /** Круги вызвавшего и твои в этой паре; null — у старых данных. */
  challengerRoundsPlayed?: number | null;
  recipientRoundsPlayed?: number | null;
  expiresAt: number;
}

export interface MyRunsResponse {
  runs: MyRunSummary[];
  /** Значение для `before` следующей страницы; null — партий больше нет. */
  nextCursor: string | null;
  invites: MyRematchInvite[];
}

/** Подтверждённая сервером сводка только по текущему зачётному solo-режиму. */
export interface SoloProfileResponse {
  completedRuns: number;
  reachedTargetRuns: number;
  /** Минимальное число кругов среди финишей до 100%; null, пока финишей нет. */
  bestRounds: number | null;
}

export interface Opponent {
  id: string;
  displayName: string;
  avatar?: string;
  rounds: OpponentRound[];
}

/** Мини-игры зачётного забега. Считаются одной математикой (CURRENT_HAMMER_MINI_GAME). */
export const MINI_GAME_IDS = ['hammer_nail', 'tower_stack'] as const;
export type MiniGameId = (typeof MINI_GAME_IDS)[number];

export const MINI_GAME_TITLES: Record<MiniGameId, string> = {
  hammer_nail: 'Молоток',
  tower_stack: 'Башня',
};

/** Одна строка правила для экрана старта забега. */
export const MINI_GAME_RULES: Record<MiniGameId, string> = {
  hammer_nail: 'Останови молоток точно над гвоздём: чем точнее удар, тем больше прогресса.',
  tower_stack: 'Урони блок ровно на башню: чем точнее совпадение, тем больше прогресса.',
};

export function isMiniGameId(value: unknown): value is MiniGameId {
  return typeof value === 'string' && (MINI_GAME_IDS as readonly string[]).includes(value);
}

export interface AsyncMatchConditions {
  rulesVersion: string;
  miniGame: {
    id: MiniGameId;
    config: MiniGameConfig;
  };
}

/** Мини-игра молотка: её конфиг считает круг соло-забега, тренировки и дуэли. */
export const CURRENT_HAMMER_MINI_GAME: AsyncMatchConditions['miniGame'] = {
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
};

/** A finished run needs at least this many played rounds to be offered as an opponent. */
export const MIN_POOL_ROUNDS = 3;

/** Соло-забег до цели: версия правил зачётных забегов и конфиг молотка. */
export const CURRENT_SOLO_RUN_CONDITIONS: AsyncMatchConditions = {
  rulesVersion: 'solo-to-100-v2',
  miniGame: CURRENT_HAMMER_MINI_GAME,
};

export * from './countries';
export * from './flagTraits';
export * from './telemetry';
export * from './historicFlags';
export * from './languages';
export * from './narrowCategories';
export * from './questionGenerator';
export * from './dailyQuestionSet';
export * from './lastStand';
export * from './seededRandom';
export * from './generalPack';
export * from './generalSet';
// Explicit: the facade shadows the generator-only versions that `export *` above also brings in.
export { isKnownQuestionId, questionIdCategory, resolveQuestionById } from './questionResolve';
