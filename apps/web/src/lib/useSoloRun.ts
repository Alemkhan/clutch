import { useCallback, useEffect, useRef, useState } from 'react';
import type { CategoryId, CompleteSoloRunResponse } from '@clutch/shared';
import { completeSoloRun, isTransientApiError, startSoloRun } from './api';
import { normalizeSoloRun } from './clientMatchRules';
import { MatchRequestCoordinator } from './matchmaking';
import {
  applyLoadedSoloRun,
  beginSoloLoading,
  completeSoloHammer,
  continueSoloAfterResolution,
  createSoloFlowState,
  failSoloLoading,
  recordSoloAnswer,
  soloStartErrorMessage,
  startSoloPlay,
  type SoloFlowState,
} from './soloRunFlow';
import { parseSoloCompletion, type SoloSaveStatus } from './soloResult';

export interface SoloSaveState {
  status: SoloSaveStatus;
  response: CompleteSoloRunResponse | null;
  error?: string;
  canRetry: boolean;
}

const SAVING: SoloSaveState = { status: 'saving', response: null, canRetry: false };

/** Сетевая обвязка соло-забега: старт и сохранение результата. Правила остаются в soloRunFlow. */
export function useSoloRun() {
  const [state, setState] = useState<SoloFlowState>(createSoloFlowState);
  const [save, setSave] = useState<SoloSaveState>(SAVING);
  const coordinatorRef = useRef(new MatchRequestCoordinator());
  const saveControllerRef = useRef<AbortController | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const begin = useCallback((category: CategoryId) => {
    const request = coordinatorRef.current.begin(category);
    if (!request) return;
    setState(beginSoloLoading(category));
    void startSoloRun(category, request.signal).then((raw) => {
      if (!coordinatorRef.current.isCurrent(request.token)) return;
      let run;
      try {
        run = normalizeSoloRun(raw);
      } catch (error) {
        console.error('Invalid solo run response:', error);
        if (!coordinatorRef.current.settle(request.token)) return;
        setState((previous) => failSoloLoading(previous, soloStartErrorMessage(error)));
        return;
      }
      if (!coordinatorRef.current.settle(request.token)) return;
      setState((previous) => applyLoadedSoloRun(previous, run));
    }).catch((error: unknown) => {
      if (!coordinatorRef.current.settle(request.token)) return;
      setState((previous) => failSoloLoading(previous, soloStartErrorMessage(error)));
    });
  }, []);

  const retryStart = useCallback(() => begin(stateRef.current.category), [begin]);

  /** Назад с загрузки или ошибки: отменяем запрос и возвращаемся к выбору категории. */
  const backToCategories = useCallback(() => {
    coordinatorRef.current.cancel();
    saveControllerRef.current?.abort();
    saveControllerRef.current = null;
    setSave(SAVING);
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

  const sendResult = useCallback(() => {
    const { runId, roundInputs } = stateRef.current;
    if (!runId || saveControllerRef.current) return;
    const controller = new AbortController();
    saveControllerRef.current = controller;
    setSave(SAVING);
    void completeSoloRun(runId, { rounds: roundInputs }, controller.signal).then((raw) => {
      if (controller.signal.aborted) return;
      const response = parseSoloCompletion(raw, runId);
      saveControllerRef.current = null;
      if (!response) {
        setSave({ status: 'error', response: null, error: 'Сервер вернул непонятный ответ. Результат не подтверждён.', canRetry: true });
        return;
      }
      setSave({ status: 'saved', response, canRetry: false });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      saveControllerRef.current = null;
      const transient = isTransientApiError(error);
      setSave({
        status: 'error',
        response: null,
        error: transient
          ? 'Не удалось сохранить результат. Проверь соединение и повтори.'
          : 'Сервер не принял результат этого забега.',
        canRetry: transient,
      });
    });
  }, []);

  // Результат отправляется один раз, когда забег закрылся; повтор — только кнопкой.
  useEffect(() => {
    if (state.stage !== 'result') return;
    sendResult();
  }, [state.stage, sendResult]);

  useEffect(() => () => {
    coordinatorRef.current.cancel();
    saveControllerRef.current?.abort();
  }, []);

  const retrySave = useCallback(() => {
    saveControllerRef.current = null;
    sendResult();
  }, [sendResult]);

  return {
    state,
    save,
    begin,
    retryStart,
    backToCategories,
    start,
    answer,
    continueAfterResolution,
    completeHammer,
    retrySave,
  };
}
