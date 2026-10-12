import { useCallback, useEffect, useRef, useState } from 'react';
import type { CategoryId, CompleteSoloRunResponse, PracticeLevelId } from '@clutch/shared';
import {
  ApiError,
  answerSoloRound,
  fetchSoloRunSnapshot,
  hammerSoloRound,
  isTransientApiError,
  startSoloRun,
} from './api';
import { normalizeSoloRun, normalizeSoloSnapshot } from './clientMatchRules';
import { MatchRequestCoordinator } from './matchmaking';
import {
  applyLoadedSoloRun,
  applySoloAnswerVerdict,
  applySoloHammerVerdict,
  beginSoloLoading,
  completeSoloHammer,
  continueSoloAfterResolution,
  createSoloFlowState,
  failSoloLoading,
  failSoloSync,
  recordSoloAnswer,
  restoreSoloRun,
  retrySoloSync,
  soloStartErrorMessage,
  startSoloPlay,
  type SoloFlowState,
} from './soloRunFlow';
import { deliverRound } from './soloRoundDelivery';
import { clearActiveSoloRun, loadActiveSoloRun, saveActiveSoloRun } from './soloRunStore';
import { parseSoloRound, type SoloSaveStatus } from './soloResult';

export interface SoloSaveState {
  status: SoloSaveStatus;
  response: CompleteSoloRunResponse | null;
  error?: string;
  canRetry: boolean;
}

const SAVING: SoloSaveState = { status: 'saving', response: null, canRetry: false };

interface SyncIssue {
  message: string;
  /** true — связь пропала, тот же круг можно отправить снова; false — сервер круг не принимает. */
  canRetry: boolean;
}

/**
 * Сетевая обвязка соло-забега: старт, покруговая отправка и продолжение. Правила остаются в soloRunFlow.
 * Каждый круг уходит на сервер сразу и сохраняется там; при обрыве запрос повторяется, а закрытая вкладка
 * забег не теряет: id забега лежит в localStorage, остальное хранит сервер.
 * botLevel: тренировка против бота. Остальное — как в обычном забеге.
 */
export function useSoloRun(botLevel?: PracticeLevelId) {
  const practice = botLevel !== undefined;
  const [state, setState] = useState<SoloFlowState>(createSoloFlowState);
  const [syncIssue, setSyncIssue] = useState<SyncIssue | null>(null);
  const coordinatorRef = useRef(new MatchRequestCoordinator());
  // Реванш: тот же invite повторяется при «Повторить» и сбрасывается при выходе к категориям.
  const inviteRef = useRef<string>();
  const stateRef = useRef(state);
  stateRef.current = state;

  const begin = useCallback((category: CategoryId, rematchInviteId?: string) => {
    inviteRef.current = rematchInviteId;
    const request = coordinatorRef.current.begin(rematchInviteId ?? category);
    if (!request) return;
    setSyncIssue(null);
    setState(beginSoloLoading(category));
    void startSoloRun(category, request.signal, rematchInviteId, botLevel).then((raw) => {
      if (!coordinatorRef.current.isCurrent(request.token)) return;
      let run;
      try {
        run = normalizeSoloRun(raw, practice);
      } catch (error) {
        console.error('Invalid solo run response:', error);
        if (!coordinatorRef.current.settle(request.token)) return;
        setState((previous) => failSoloLoading(previous, soloStartErrorMessage(error)));
        return;
      }
      if (!coordinatorRef.current.settle(request.token)) return;
      saveActiveSoloRun({ runId: run.runId, practice });
      setState((previous) => applyLoadedSoloRun(previous, run));
    }).catch((error: unknown) => {
      if (!coordinatorRef.current.settle(request.token)) return;
      setState((previous) => failSoloLoading(previous, soloStartErrorMessage(error)));
    });
  }, [botLevel, practice]);

  const retryStart = useCallback(() => begin(stateRef.current.category, inviteRef.current), [begin]);

  /** Подтягивает забег с сервера: после закрытой вкладки или когда клиент разошёлся с сервером. */
  const restoreFromServer = useCallback((runId: string, onFailure: () => void) => {
    const request = coordinatorRef.current.begin(`restore:${runId}`);
    if (!request) return;
    void fetchSoloRunSnapshot(runId, request.signal).then((raw) => {
      if (!coordinatorRef.current.settle(request.token)) return;
      let snapshot;
      try {
        snapshot = normalizeSoloSnapshot(raw, practice);
      } catch (error) {
        console.error('Invalid solo run snapshot:', error);
        clearActiveSoloRun();
        onFailure();
        return;
      }
      setSyncIssue(null);
      setState(restoreSoloRun(snapshot));
    }).catch((error: unknown) => {
      if (!coordinatorRef.current.settle(request.token)) return;
      // Забега нет или он чужой — забываем его; при обрыве связи id остаётся для следующей попытки.
      if (!isTransientApiError(error)) clearActiveSoloRun();
      onFailure();
    });
  }, [practice]);

  /** Продолжение забега, начатого раньше на этом устройстве (если он ещё не закрыт). */
  const resume = useCallback(() => {
    const stored = loadActiveSoloRun();
    if (!stored || stored.practice !== practice || stateRef.current.stage !== 'categories') return;
    setState(beginSoloLoading(stateRef.current.category));
    restoreFromServer(stored.runId, () => setState(createSoloFlowState()));
  }, [practice, restoreFromServer]);

  /** Назад с загрузки, ошибки или готового забега: отменяем запрос и возвращаемся к выбору категории. */
  const backToCategories = useCallback(() => {
    inviteRef.current = undefined;
    coordinatorRef.current.cancel();
    clearActiveSoloRun();
    setSyncIssue(null);
    setState(createSoloFlowState());
  }, []);

  const start = useCallback(() => {
    setState(startSoloPlay);
  }, []);

  const answer = useCallback((optionId: string, timeMs: number) => {
    setState((previous) => recordSoloAnswer(previous, optionId, timeMs));
  }, []);
  const continueAfterResolution = useCallback(() => setState(continueSoloAfterResolution), []);
  const completeHammer = useCallback((_result: unknown, _progress: number, distance: number) => {
    setState((previous) => completeSoloHammer(previous, distance));
  }, []);

  // Отправка круга. Пока сервер не подтвердил, запрос висит в state.pending; повторы автоматические,
  // потом остаётся кнопка. Дубликат сервер не считает, так что лишний запрос ничего не ломает.
  const { pending, runId, syncFailed } = state;
  useEffect(() => {
    if (!pending || !runId || syncFailed) return undefined;
    const controller = new AbortController();
    void (async () => {
      const outcome = await deliverRound(
        (signal) => (pending.kind === 'answer'
          ? answerSoloRound(runId, pending.request, signal)
          : hammerSoloRound(runId, pending.request, signal)),
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      if (outcome.ok) {
        const response = parseSoloRound(outcome.value, runId);
        if (!response) {
          setSyncIssue({ message: 'Сервер вернул непонятный ответ. Круг не засчитан.', canRetry: false });
          setState((previous) => failSoloSync(previous, 'invalid'));
          return;
        }
        setSyncIssue(null);
        setState((previous) => (pending.kind === 'answer'
          ? applySoloAnswerVerdict(previous, response)
          : applySoloHammerVerdict(previous, response)));
        return;
      }
      // 409: клиент разошёлся с сервером (например, забег уже закрыт в другой вкладке) — берём правду оттуда.
      if (outcome.error instanceof ApiError && outcome.error.status === 409) {
        restoreFromServer(runId, () => {
          setSyncIssue({ message: 'Сервер не принял этот круг. Начни забег заново.', canRetry: false });
          setState((previous) => failSoloSync(previous, 'conflict'));
        });
        return;
      }
      setSyncIssue(outcome.transient
        ? { message: 'Нет связи с сервером. Прогресс не потерян: проверь соединение и повтори.', canRetry: true }
        : { message: 'Сервер не принял этот круг.', canRetry: false });
      setState((previous) => failSoloSync(previous, outcome.transient ? 'offline' : 'rejected'));
    })();
    return () => controller.abort();
  }, [pending, runId, syncFailed, restoreFromServer]);

  const retrySync = useCallback(() => {
    setSyncIssue(null);
    setState(retrySoloSync);
  }, []);

  // Связь вернулась — зависший круг уходит сам.
  useEffect(() => {
    const onOnline = () => {
      if (stateRef.current.pending && stateRef.current.syncFailed) retrySync();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [retrySync]);

  // Забег закрыт: продолжать больше нечего.
  useEffect(() => {
    if (state.stage === 'result') clearActiveSoloRun();
  }, [state.stage]);

  useEffect(() => () => {
    coordinatorRef.current.cancel();
  }, []);

  const save: SoloSaveState = state.result
    ? { status: 'saved', response: state.result, canRetry: false }
    : SAVING;

  return {
    state,
    save,
    syncError: state.syncFailed ? syncIssue?.message ?? null : null,
    canRetrySync: syncIssue?.canRetry ?? false,
    begin,
    retryStart,
    resume,
    backToCategories,
    start,
    answer,
    continueAfterResolution,
    completeHammer,
    retrySync,
  };
}
