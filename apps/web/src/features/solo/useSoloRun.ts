import { useCallback, useRef, useState } from 'react';
import type { CompleteSoloRunResponse, PracticeLevelId, SoloMode } from '@clutch/shared';
import { MatchRequestCoordinator } from './matchmaking';
import {
  completeSoloHammer,
  continueSoloAfterResolution,
  createSoloFlowState,
  recordSoloAnswer,
  retrySoloSync,
  startSoloPlay,
  type SoloFlowState,
} from './soloRunFlow';
import type { SoloRunContext } from './soloRunContext';
import type { SoloSaveStatus } from './soloResultModel';
import type { SyncIssue } from './soloSyncIssue';
import { useRoundDelivery } from './useRoundDelivery';
import { useSoloRunLifecycle } from './useSoloRunLifecycle';
import { useSoloRunRestore } from './useSoloRunRestore';
import { useSoloRunStart } from './useSoloRunStart';

export interface SoloSaveState {
  status: SoloSaveStatus;
  response: CompleteSoloRunResponse | null;
  error?: string;
  canRetry: boolean;
}

const SAVING: SoloSaveState = { status: 'saving', response: null, canRetry: false };

/**
 * Сетевая обвязка соло-забега: старт, покруговая отправка и продолжение. Правила остаются в soloRunFlow.
 * Каждый круг уходит на сервер сразу и сохраняется там; при обрыве запрос повторяется, а закрытая вкладка
 * забег не теряет: id забега лежит в localStorage, остальное хранит сервер.
 * botLevel: тренировка против бота. Остальное — как в обычном забеге.
 */
export function useSoloRun(botLevel?: PracticeLevelId, mode: SoloMode = 'daily') {
  const [state, setState] = useState<SoloFlowState>(createSoloFlowState);
  const [syncIssue, setSyncIssue] = useState<SyncIssue | null>(null);
  const coordinatorRef = useRef(new MatchRequestCoordinator());
  const inviteRef = useRef<string>();
  const stateRef = useRef(state);
  stateRef.current = state;
  const ctx: SoloRunContext = {
    setState, setSyncIssue, coordinatorRef, inviteRef, stateRef, practice: botLevel !== undefined, mode,
  };

  const { begin, retryStart } = useSoloRunStart(ctx, botLevel);
  const { restoreFromServer, resume, backToCategories } = useSoloRunRestore(ctx, begin);

  const start = useCallback(() => {
    setState(startSoloPlay);
  }, []);
  const answer = useCallback((optionId: string, timeMs: number) => {
    setState((previous) => recordSoloAnswer(previous, optionId, timeMs));
  }, []);
  const continueAfterResolution = useCallback(() => setState(continueSoloAfterResolution), []);
  const completeHammer = useCallback((_result: unknown, _progress: number, activeElapsedMs: number) => {
    setState((previous) => completeSoloHammer(previous, activeElapsedMs));
  }, []);
  const retrySync = useCallback(() => {
    setSyncIssue(null);
    setState(retrySoloSync);
  }, []);

  useRoundDelivery(state, ctx, restoreFromServer);
  useSoloRunLifecycle(state, ctx, retrySync);

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
