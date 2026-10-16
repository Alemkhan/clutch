import type {
  CategoryId,
  CompleteSoloRunResponse,
  MiniGameConfig,
  Opponent,
  SkillResult,
  SoloAnswerRequest,
  SoloHammerRequest,
  SoloRoundResponse,
} from '@clutch/shared';
import { CURRENT_SOLO_RUN_CONDITIONS, SKILL_REWARDS } from '@clutch/shared';
import { ApiError } from './api';
import type { NormalizedSoloRun, NormalizedSoloSnapshot } from './clientMatchRules';
import {
  applySoloSessionRound,
  createSoloRunSession,
  soloRunView,
  type SoloRunSession,
  type SoloRunView,
} from './soloRunSession';

/**
 * Экранные шаги соло-забега. Чистые переходы без React и сети.
 *
 * Клиент не знает правильных ответов и не считает награду: каждый шаг круга уходит на сервер, а следующий
 * экран строится из его ответа. Пока запрос не подтверждён (`pending`), круг не засчитан, и его можно
 * безопасно отправить ещё раз: сервер повтор не считает дважды.
 * Забег закрывает сервер (shared/soloRun.ts); клиентская копия правил нужна только для полос и счётчиков.
 */
export type SoloStage =
  | 'categories' | 'loading' | 'error' | 'ready'
  | 'question' | 'checking' | 'resolution' | 'hammer' | 'submitting' | 'result';

/** Запрос, который ждёт подтверждения сервера. */
export type SoloPending =
  | { kind: 'answer'; request: SoloAnswerRequest }
  | { kind: 'hammer'; request: SoloHammerRequest };

export interface SoloFlowState {
  stage: SoloStage;
  category: CategoryId;
  runId?: string;
  session: SoloRunSession | null;
  config: MiniGameConfig;
  bankExhausted: boolean;
  /** Забег по дружеской ссылке: вне соревнования. */
  friendDuel: boolean;
  /** Забег продолжен после закрытой вкладки. */
  resumed: boolean;
  /** Соперник отпущен за время отсутствия: полоса соперника исчезла не просто так. */
  paceReleased: boolean;
  selectedOption: string;
  lastCorrect: boolean;
  /** Явный правильный ответ: появляется только после серверного вердикта. */
  correctAnswer: string;
  /** Пояснение к текущему вопросу: приходит с вердиктом сервера, раньше его нет. */
  explanation: string;
  correctCount: number;
  responseTimes: number[];
  skillResults: SkillResult[];
  pending: SoloPending | null;
  /** Повторы исчерпаны, запрос не дошёл: показываем «Повторить», прогресс не потерян. */
  syncFailed: boolean;
  /** Итог забега от сервера; появляется вместе с последним кругом. */
  result: CompleteSoloRunResponse | null;
  error?: string;
}

/** Шаги, на которых нельзя случайно уйти системной кнопкой «Назад». */
const ACTIVE_STAGES: ReadonlySet<SoloStage> = new Set<SoloStage>([
  'question', 'checking', 'resolution', 'hammer', 'submitting',
]);

export function isSoloPlaying(stage: SoloStage): boolean {
  return ACTIVE_STAGES.has(stage);
}

export function createSoloFlowState(): SoloFlowState {
  return {
    stage: 'categories',
    category: 'general',
    session: null,
    config: CURRENT_SOLO_RUN_CONDITIONS.miniGame.config,
    bankExhausted: false,
    friendDuel: false,
    resumed: false,
    paceReleased: false,
    selectedOption: '',
    lastCorrect: false,
    correctAnswer: '',
    explanation: '',
    correctCount: 0,
    responseTimes: [],
    skillResults: [],
    pending: null,
    syncFailed: false,
    result: null,
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
    friendDuel: run.friendDuel === true,
  };
}

/**
 * Забег, продолженный с сервера: сыгранные круги берём из его записи и прогоняем через те же правила shared.
 * Закрытый забег сразу показывает итог; открытый ждёт кнопку «Продолжить» на следующем вопросе.
 */
export function restoreSoloRun(snapshot: NormalizedSoloSnapshot): SoloFlowState {
  let session = createSoloRunSession(snapshot.questions, snapshot.pace);
  const skillResults: SkillResult[] = [];
  for (const round of snapshot.rounds) {
    session = applySoloSessionRound(session, round.progressAwarded);
    if (round.skillResult) skillResults.push(round.skillResult);
  }
  const completed = snapshot.status === 'completed';
  return {
    ...createSoloFlowState(),
    stage: completed ? 'result' : 'ready',
    category: snapshot.category,
    runId: snapshot.runId,
    session,
    config: snapshot.config,
    friendDuel: snapshot.friendDuel === true,
    resumed: true,
    paceReleased: snapshot.paceReleased === true,
    correctCount: snapshot.rounds.filter((round) => round.correct).length,
    responseTimes: snapshot.rounds.map((round) => round.responseTimeMs),
    skillResults,
    result: completed ? snapshot.result : null,
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

/** Ответ игрока уходит на проверку серверу; верность мы узнаем только из его ответа. */
export function recordSoloAnswer(
  state: Readonly<SoloFlowState>,
  selectedOption: string,
  responseTimeMs: number,
): SoloFlowState {
  const question = currentSoloQuestion(state);
  if (state.stage !== 'question' || !question || !state.runId) return state as SoloFlowState;
  return {
    ...state,
    stage: 'checking',
    selectedOption,
    syncFailed: false,
    responseTimes: [...state.responseTimes, responseTimeMs],
    pending: {
      kind: 'answer',
      request: {
        roundIndex: requireSession(state).run.roundsPlayed,
        questionId: question.id,
        selectedAnswer: selectedOption,
        responseTimeMs,
      },
    },
  };
}

function matchesPending(state: Readonly<SoloFlowState>, kind: SoloPending['kind'], response: SoloRoundResponse): boolean {
  return state.pending?.kind === kind
    && state.pending.request.roundIndex === response.roundIndex
    && state.pending.request.questionId === response.questionId
    && response.runId === state.runId;
}

/** Вердикт сервера по ответу: верно или нет, пояснение; неверный круг уже закрыт им с нулевой наградой. */
export function applySoloAnswerVerdict(state: Readonly<SoloFlowState>, response: SoloRoundResponse): SoloFlowState {
  if (!matchesPending(state, 'answer', response)) return state as SoloFlowState;
  const question = currentSoloQuestion(state);
  const correctAnswer = question?.answerType === 'open_answer'
    ? response.correctAnswers?.[0] ?? ''
    : question?.options.find((option) => option.id === response.correctOptionId)?.text ?? '';
  return {
    ...state,
    stage: 'resolution',
    pending: null,
    syncFailed: false,
    lastCorrect: response.correct,
    correctAnswer,
    explanation: response.explanation,
    correctCount: response.correct ? state.correctCount + 1 : state.correctCount,
    result: response.result ?? state.result,
  };
}

function afterRound(state: SoloFlowState, session: SoloRunSession): SoloFlowState {
  return { ...state, session, stage: soloRunView(session).completed ? 'result' : 'question' };
}

/** Верный ответ даёт попытку; неверный круг сервер уже закрыл, остаётся перейти дальше. */
export function continueSoloAfterResolution(state: Readonly<SoloFlowState>): SoloFlowState {
  if (state.stage !== 'resolution') return state as SoloFlowState;
  if (state.lastCorrect) return { ...state, stage: 'hammer' };
  return afterRound({ ...state }, applySoloSessionRound(requireSession(state), 0));
}

/** Устройство сообщает только момент удара; расстояние до цели и награду выводит сервер. */
export function completeSoloHammer(state: Readonly<SoloFlowState>, activeElapsedMs: number): SoloFlowState {
  const question = currentSoloQuestion(state);
  if (state.stage !== 'hammer' || !question) return state as SoloFlowState;
  return {
    ...state,
    stage: 'submitting',
    syncFailed: false,
    pending: {
      kind: 'hammer',
      request: {
        roundIndex: requireSession(state).run.roundsPlayed,
        questionId: question.id,
        activeElapsedMs,
      },
    },
  };
}

/** Итог удара от сервера: награда и прогресс его, клиент только отражает их в своих полосах. */
export function applySoloHammerVerdict(state: Readonly<SoloFlowState>, response: SoloRoundResponse): SoloFlowState {
  if (!matchesPending(state, 'hammer', response) || response.awaitingHammer) return state as SoloFlowState;
  const session = applySoloSessionRound(requireSession(state), response.progressAwarded);
  return afterRound({
    ...state,
    pending: null,
    syncFailed: false,
    skillResults: [...state.skillResults, response.skillResult ?? 'miss'],
    result: response.result ?? state.result,
  }, session);
}

/** Запрос не дошёл после всех повторов: круг не потерян, его можно отправить снова. */
export function failSoloSync(state: Readonly<SoloFlowState>, error: string): SoloFlowState {
  if (!state.pending) return state as SoloFlowState;
  return { ...state, syncFailed: true, error };
}

export function retrySoloSync(state: Readonly<SoloFlowState>): SoloFlowState {
  return state.pending ? { ...state, syncFailed: false, error: undefined } : state as SoloFlowState;
}

export function soloFlowView(state: Readonly<SoloFlowState>): SoloRunView | null {
  return state.session ? soloRunView(state.session) : null;
}

/** Сколько кругов реально осталось: потолок или конец набора, что ближе. */
export function soloRoundsLeft(view: Pick<SoloRunView, 'roundsToCap' | 'questionsLeft'>): number {
  return Math.min(view.roundsToCap, view.questionsLeft);
}

export function soloPaceOf(state: Readonly<SoloFlowState>): Opponent | null {
  return state.session?.pace ?? null;
}

export function soloStartErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.reason === 'taken') return 'Ссылку уже занял другой игрок.';
  if (error instanceof ApiError && error.reason === 'expired') return 'Срок ссылки вышел.';
  if (error instanceof ApiError && error.reason === 'own') return 'Это твоя ссылка. Отправь её другу.';
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
