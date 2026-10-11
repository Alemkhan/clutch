import type {
  AsyncMatchRoundInput,
  CategoryId,
  MiniGameConfig,
  Opponent,
  SkillResult,
} from '@clutch/shared';
import { CURRENT_SOLO_RUN_CONDITIONS, SKILL_REWARDS, isAnswerCorrect } from '@clutch/shared';
import { ApiError } from './api';
import { scoreSkillDistance, type NormalizedSoloRun } from './clientMatchRules';
import {
  applySoloSessionRound,
  createSoloRunSession,
  soloRunView,
  type SoloRunSession,
  type SoloRunView,
} from './soloRunSession';

/**
 * Экранные шаги соло-забега. Чистые переходы без React и сети, как gameSession для гонки.
 * Забег закрывают только правила в soloRunSession: темп соперника сюда не заходит.
 */
export type SoloStage =
  | 'categories' | 'loading' | 'error' | 'ready'
  | 'question' | 'resolution' | 'hammer' | 'result';

export interface SoloFlowState {
  stage: SoloStage;
  category: CategoryId;
  runId?: string;
  session: SoloRunSession | null;
  config: MiniGameConfig;
  bankExhausted: boolean;
  selectedOption: string;
  lastCorrect: boolean;
  correctCount: number;
  responseTimes: number[];
  skillResults: SkillResult[];
  roundInputs: AsyncMatchRoundInput[];
  error?: string;
}

/** Шаги, на которых нельзя случайно уйти системной кнопкой «Назад». */
const ACTIVE_STAGES: ReadonlySet<SoloStage> = new Set<SoloStage>(['question', 'resolution', 'hammer']);

export function isSoloPlaying(stage: SoloStage): boolean {
  return ACTIVE_STAGES.has(stage);
}

export function createSoloFlowState(): SoloFlowState {
  return {
    stage: 'categories',
    category: 'geography',
    session: null,
    config: CURRENT_SOLO_RUN_CONDITIONS.miniGame.config,
    bankExhausted: false,
    selectedOption: '',
    lastCorrect: false,
    correctCount: 0,
    responseTimes: [],
    skillResults: [],
    roundInputs: [],
  };
}

export function beginSoloLoading(category: CategoryId): SoloFlowState {
  return { ...createSoloFlowState(), stage: 'loading', category };
}

export function failSoloLoading(state: SoloFlowState, error: string): SoloFlowState {
  return { ...state, stage: 'error', error };
}

export function applyLoadedSoloRun(state: SoloFlowState, run: NormalizedSoloRun): SoloFlowState {
  return {
    ...state,
    stage: 'ready',
    runId: run.runId,
    session: createSoloRunSession(run.questions, run.pace),
    config: run.config,
    bankExhausted: run.bankExhausted,
  };
}

export function startSoloPlay(state: SoloFlowState): SoloFlowState {
  if (state.stage !== 'ready' || !state.session) return state;
  return { ...state, stage: 'question' };
}

function requireSession(state: Readonly<SoloFlowState>): SoloRunSession {
  if (!state.session) throw new Error('solo run is not loaded');
  return state.session;
}

export function currentSoloQuestion(state: Readonly<SoloFlowState>) {
  const session = state.session;
  return session ? session.questions[session.run.roundsPlayed] : undefined;
}

export function recordSoloAnswer(
  state: Readonly<SoloFlowState>,
  selectedOption: string,
  responseTimeMs: number,
): SoloFlowState {
  const question = currentSoloQuestion(state);
  const correct = question?.answerType === 'open_answer'
    ? isAnswerCorrect(selectedOption, question.correctAnswers ?? []).correct
    : Boolean(question && selectedOption === question.correctOptionId);
  return {
    ...state,
    stage: 'resolution',
    selectedOption,
    lastCorrect: correct,
    correctCount: correct ? state.correctCount + 1 : state.correctCount,
    responseTimes: [...state.responseTimes, responseTimeMs],
  };
}

function currentRoundInput(state: Readonly<SoloFlowState>, skillDistance?: number): AsyncMatchRoundInput {
  return {
    questionId: currentSoloQuestion(state)!.id,
    selectedAnswer: state.selectedOption,
    responseTimeMs: state.responseTimes[state.responseTimes.length - 1] ?? 0,
    ...(skillDistance === undefined ? {} : { skillDistance }),
  };
}

function afterRound(state: SoloFlowState, session: SoloRunSession): SoloFlowState {
  return { ...state, session, stage: soloRunView(session).completed ? 'result' : 'question' };
}

/** Верный ответ даёт попытку; неверный закрывает круг с нулём и идёт дальше без мини-игры. */
export function continueSoloAfterResolution(state: Readonly<SoloFlowState>): SoloFlowState {
  if (state.lastCorrect) return { ...state, stage: 'hammer' };
  const session = applySoloSessionRound(requireSession(state), 0);
  return afterRound({ ...state, roundInputs: [...state.roundInputs, currentRoundInput(state)] }, session);
}

export function completeSoloHammer(state: Readonly<SoloFlowState>, distance: number): SoloFlowState {
  const scored = scoreSkillDistance(distance, state.skillResults, state.config);
  const session = applySoloSessionRound(requireSession(state), scored.progressAwarded);
  return afterRound({
    ...state,
    skillResults: [...state.skillResults, scored.result],
    roundInputs: [...state.roundInputs, currentRoundInput(state, distance)],
  }, session);
}

export function soloFlowView(state: Readonly<SoloFlowState>): SoloRunView | null {
  return state.session ? soloRunView(state.session) : null;
}

/** Сколько кругов реально осталось: потолок или конец набора, что ближе. */
export function soloRoundsLeft(view: Pick<SoloRunView, 'roundsToCap' | 'questionsLeft'>): number {
  return Math.min(view.roundsToCap, view.questionsLeft);
}

export function bestSoloSkill(results: readonly SkillResult[]): SkillResult | null {
  let best: SkillResult | null = null;
  for (const result of results) {
    if (!best || SKILL_REWARDS[result] > SKILL_REWARDS[best]) best = result;
  }
  return best;
}

export function soloPaceOf(state: Readonly<SoloFlowState>): Opponent | null {
  return state.session?.pace ?? null;
}

export function soloStartErrorMessage(error: unknown): string {
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    return 'Не удалось подтвердить сессию или доступ. Вернись в Telegram или обнови страницу.';
  }
  if (error instanceof ApiError && error.status >= 400 && error.status < 500
    && error.status !== 408 && error.status !== 425 && error.status !== 429) {
    return 'Сервер не смог начать забег. Попробуй ещё раз.';
  }
  if (error instanceof Error && !(error instanceof ApiError) && error.name !== 'TypeError') {
    return 'Сервер вернул некорректный забег. Попробуй ещё раз.';
  }
  return 'Не удалось начать забег. Проверь соединение и попробуй ещё раз.';
}
