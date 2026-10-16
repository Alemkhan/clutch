import { useCallback } from 'react';
import type { CategoryId, PracticeLevelId } from '@clutch/shared';
import { logAnalyticsEvent, startSoloRun } from '../../platform/api';
import { normalizeSoloRun } from './clientMatchRules';
import { applyLoadedSoloRun, beginSoloLoading, failSoloLoading, soloStartErrorMessage } from './soloRunFlow';
import type { SoloRunContext } from './soloRunContext';
import { saveActiveSoloRun } from './soloRunStore';

/** Старт забега (в том числе реванш и тренировка) и повтор после ошибки. */
export function useSoloRunStart(ctx: SoloRunContext, botLevel?: PracticeLevelId) {
  const { coordinatorRef, inviteRef, stateRef, setState, setSyncIssue, practice } = ctx;

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
      // Продуктовое событие (R22): забег создан (продолжение закрытого — не «старт»).
      logAnalyticsEvent('solo_run_started', { category });
    }).catch((error: unknown) => {
      if (!coordinatorRef.current.settle(request.token)) return;
      setState((previous) => failSoloLoading(previous, soloStartErrorMessage(error)));
    });
  }, [botLevel, practice]);

  const retryStart = useCallback(() => begin(stateRef.current.category, inviteRef.current), [begin]);

  return { begin, retryStart };
}
