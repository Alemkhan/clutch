import {
  CURRENT_HAMMER_MINI_GAME,
  CURRENT_SOLO_RUN_CONDITIONS,
  DAILY_SET_SIZES,
  FRIEND_RULES_VERSION,
  PRACTICE_RULES_VERSION,
  SOLO_ROUND_CAP,
  SOLO_TARGET_PROGRESS,
  SKILL_REWARDS,
  type MiniGameConfig,
  type Opponent,
  type OpponentRound,
  type PublicQuestion,
  type SoloRunSnapshot,
  type StartSoloRunResponse,
} from '@clutch/shared';

const supportedRewards = new Set<number>(Object.values(SKILL_REWARDS));

/** Форма вопроса без ответов: то, что нужно для показа. Ответов здесь быть не должно и не требуется. */
function validatePublicQuestions(questions: readonly PublicQuestion[]): void {
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
    if (question.answerType === 'multiple_choice' && optionIds.size === 0) {
      throw new Error('Match question has no options.');
    }
    ids.add(question.id);
  }
}

export function validateMiniGameConfig(value: unknown): MiniGameConfig {
  if (!value || typeof value !== 'object') throw new Error('Mini-game config is missing.');
  const config = value as Record<string, unknown>;
  const current = CURRENT_HAMMER_MINI_GAME.config;
  const pressure = config.pressure as Record<string, unknown> | undefined;
  if (Object.keys(config).length !== 5
    || config.markerSpeedMin !== current.markerSpeedMin
    || config.markerSpeedMax !== current.markerSpeedMax
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

export interface NormalizedSoloRun {
  runId: string;
  questions: PublicQuestion[];
  /** Темп для полосы; null — записи нет или она не подходит к набору. Забег темп не завершает. */
  pace: Opponent | null;
  config: MiniGameConfig;
  bankExhausted: boolean;
  /** Забег по дружеской ссылке: вне соревнования, исход против записи автора считается. */
  friendDuel?: boolean;
}

/** Темп — только картинка: битую запись не рисуем, но и забег из-за неё не отменяем. */
function normalizeSoloPace(pace: Opponent | null, questions: readonly PublicQuestion[]): Opponent | null {
  if (!pace || typeof pace.id !== 'string' || pace.id.length === 0
    || typeof pace.displayName !== 'string' || pace.displayName.trim().length === 0
    || !Array.isArray(pace.rounds) || pace.rounds.length > questions.length) return null;
  try {
    pace.rounds.forEach((round, index) => {
      validateRound(round);
      if (round.questionId !== questions[index].id) throw new Error('Pace round is out of order.');
    });
  } catch {
    return null;
  }
  return pace;
}

/** practice: ответ тренировки против бота идёт со своей версией правил. */
export function normalizeSoloRun(run: StartSoloRunResponse, practice = false): NormalizedSoloRun {
  if (!run || typeof run.runId !== 'string' || run.runId.length === 0 || !Array.isArray(run.questions)) {
    throw new Error('Solo run response is invalid.');
  }
  const friendDuel = !practice && run.rulesVersion === FRIEND_RULES_VERSION;
  const expectedRules = practice ? PRACTICE_RULES_VERSION : CURRENT_SOLO_RUN_CONDITIONS.rulesVersion;
  if ((run.rulesVersion !== expectedRules && !friendDuel)
    || run.target !== SOLO_TARGET_PROGRESS || run.roundCap !== SOLO_ROUND_CAP) {
    throw new Error('Solo run conditions are not supported by this client.');
  }
  validatePublicQuestions(run.questions);
  const pace = normalizeSoloPace(run.pace ?? null, run.questions);
  if (practice && !pace) throw new Error('Practice run has no usable bot.');
  return {
    runId: run.runId,
    questions: run.questions,
    pace,
    config: validateMiniGameConfig(CURRENT_SOLO_RUN_CONDITIONS.miniGame.config),
    bankExhausted: run.bankExhausted === true,
    friendDuel,
  };
}

/** Забег, продолженный после закрытой вкладки: те же проверки, что у старта, плюс сыгранные круги. */
export interface NormalizedSoloSnapshot extends NormalizedSoloRun {
  /** Соперника отпустили, пока игрока не было: забег продолжается один. */
  paceReleased?: boolean;
  category: SoloRunSnapshot['category'];
  rounds: SoloRunSnapshot['rounds'];
  status: SoloRunSnapshot['status'];
  result: SoloRunSnapshot['result'];
}

export function normalizeSoloSnapshot(snapshot: SoloRunSnapshot, practice = false): NormalizedSoloSnapshot {
  const run = normalizeSoloRun(snapshot, practice);
  if (!Array.isArray(snapshot.rounds) || snapshot.rounds.length > run.questions.length
    || (snapshot.status !== 'in_progress' && snapshot.status !== 'completed')
    || !Object.hasOwn(DAILY_SET_SIZES, snapshot.category)) {
    throw new Error('Solo run snapshot is invalid.');
  }
  snapshot.rounds.forEach((round, index) => {
    if (!round || round.questionId !== run.questions[index].id || typeof round.correct !== 'boolean'
      || !supportedRewards.has(round.progressAwarded) || !Number.isFinite(round.responseTimeMs)) {
      throw new Error('Solo run snapshot has an invalid round.');
    }
  });
  return {
    ...run,
    category: snapshot.category,
    rounds: snapshot.rounds,
    status: snapshot.status,
    result: snapshot.result ?? null,
    paceReleased: snapshot.paceReleased === true,
  };
}
