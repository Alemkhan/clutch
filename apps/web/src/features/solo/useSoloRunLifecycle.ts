import { useEffect, useRef } from 'react';
import { logAnalyticsEvent } from '../../platform/api';
import { isSoloPlaying, type SoloFlowState } from './soloRunFlow';
import type { SoloRunContext } from './soloRunContext';
import { clearActiveSoloRun } from './soloRunStore';

/** Побочные эффекты жизни забега: возврат связи, закрытие, событие завершения, отмена запроса при уходе. */
export function useSoloRunLifecycle(
  state: SoloFlowState,
  ctx: Pick<SoloRunContext, 'stateRef' | 'coordinatorRef'>,
  retrySync: () => void,
) {
  const { stateRef, coordinatorRef } = ctx;

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

  // Продуктовое событие (R22): забег доигран до итога. Отсекаем возврат уже закрытого забега
  // (продолжение сразу в 'result') — событие только о переходе из игры, и по одному на забег.
  const previousStageRef = useRef<SoloFlowState['stage']>('categories');
  const loggedCompletionsRef = useRef(new Set<string>());
  useEffect(() => {
    const previous = previousStageRef.current;
    previousStageRef.current = state.stage;
    const result = state.result;
    if (state.stage !== 'result' || !result || !isSoloPlaying(previous)) return;
    if (loggedCompletionsRef.current.has(result.runId)) return;
    loggedCompletionsRef.current.add(result.runId);
    logAnalyticsEvent('solo_run_completed', {
      category: state.category,
      reachedTarget: result.reachedTarget,
      roundsPlayed: result.roundsPlayed,
    });
  }, [state.stage, state.result, state.category]);

  useEffect(() => () => {
    coordinatorRef.current.cancel();
  }, []);
}
