/** Цель забега в очках прогресса. Настраиваемая: подъём до 150–200 повышает
 *  различающую способность, но удлиняет партию. Симуляция: scripts/simulate-rating.mjs */
export const SOLO_TARGET_PROGRESS = 100;
/** Потолок кругов. Слабый игрок упирается в него примерно в 12–17% забегов. */
export const SOLO_ROUND_CAP = 20;

export interface SoloRunRound {
  questionId: string;
  progressAwarded: number;
}

export interface SoloRunState {
  roundsPlayed: number;
  /** Всегда <= SOLO_TARGET_PROGRESS. */
  progress: number;
  status: 'in_progress' | 'completed';
  /** true — дошёл до цели; false при completed — упёрся в потолок кругов или кончились вопросы. */
  reachedTarget: boolean;
}

export interface ApplySoloRoundInput {
  expectedQuestionId: string;
  round: SoloRunRound;
}

export function createSoloRunState(): SoloRunState {
  return { roundsPlayed: 0, progress: 0, status: 'in_progress', reachedTarget: false };
}

function assertValidAward(round: SoloRunRound): void {
  if (!Number.isFinite(round.progressAwarded) || round.progressAwarded < 0) {
    throw new RangeError('progressAwarded must be a finite non-negative number');
  }
}

/**
 * Применяет один уже оценённый круг, не изменяя прежнее состояние.
 * Забег кончается по цели или по потолку кругов. `roundCap` у дуэли ниже общего потолка:
 * круг, на котором соперник дошёл до цели (см. `duelRoundCap`).
 * `expectedQuestionId` берётся из авторитетного набора, не из клиента.
 */
export function applySoloRound(
  state: Readonly<SoloRunState>,
  input: Readonly<ApplySoloRoundInput>,
  roundCap: number = SOLO_ROUND_CAP,
): SoloRunState {
  if (state.status === 'completed') {
    throw new Error('cannot apply a round after the run has completed');
  }
  if (input.round.questionId !== input.expectedQuestionId) {
    throw new Error(`round must use expected question ${input.expectedQuestionId}`);
  }
  assertValidAward(input.round);

  const progress = Math.min(SOLO_TARGET_PROGRESS, state.progress + input.round.progressAwarded);
  const roundsPlayed = state.roundsPlayed + 1;
  const reachedTarget = progress === SOLO_TARGET_PROGRESS;
  const completed = reachedTarget || roundsPlayed >= roundCap;

  return {
    roundsPlayed,
    progress,
    status: completed ? 'completed' : 'in_progress',
    reachedTarget,
  };
}

function assertQuestionIds(questionIds: readonly string[]): void {
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

/**
 * Проверяет и оценивает сыгранный префикс забега по упорядоченному набору.
 * Пустой набор допустим: забег сразу завершён без цели. Набор короче потолка
 * кругов завершается, когда вопросы кончились.
 */
export function evaluateSoloRun(
  questionIds: readonly string[],
  rounds: readonly SoloRunRound[],
  roundCap: number = SOLO_ROUND_CAP,
): SoloRunState {
  assertQuestionIds(questionIds);
  if (rounds.length > questionIds.length) {
    throw new Error('run has more rounds than the question set');
  }

  let state = createSoloRunState();
  for (let index = 0; index < rounds.length; index += 1) {
    state = applySoloRound(state, { expectedQuestionId: questionIds[index], round: rounds[index] }, roundCap);
  }

  // Вопросы кончились раньше цели и потолка: забег закрыт без цели.
  const exhausted = state.roundsPlayed >= questionIds.length;
  if (state.status === 'in_progress' && exhausted) {
    return { ...state, status: 'completed', reachedTarget: false };
  }
  return state;
}
