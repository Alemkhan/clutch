import { useCallback } from 'react';
import type { CategoryId, PracticeLevelId } from '@clutch/shared';
import { logAnalyticsEvent, startSoloRun } from '../../platform/api';
import { beginSoloLoading, enterStartedSoloRun, failSoloLoading, soloStartErrorMessage } from './soloRunFlow';
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
      let entered;
      try {
        // Заранее проверяем ответ на текущем состоянии; в setState применим его же к актуальному.
        entered = enterStartedSoloRun(stateRef.current, raw, practice);
      } catch (error) {
        console.error('Invalid solo run response:', error);
        if (!coordinatorRef.current.settle(request.token)) return;
        setState((previous) => failSoloLoading(previous, soloStartErrorMessage(error)));
        return;
      }
      if (!coordinatorRef.current.settle(request.token)) return;
      saveActiveSoloRun({ runId: raw.runId, practice });
      setState((previous) => enterStartedSoloRun(previous, raw, practice));
      // Продуктовое событие (R22): забег создан. Продолжение начатого — не «старт».
      if (!entered.resumed) logAnalyticsEvent('solo_run_started', { category });
    }).catch((error: unknown) => {
      if (!coordinatorRef.current.settle(request.token)) return;
      setState((previous) => failSoloLoading(previous, soloStartErrorMessage(error)));
    });
  }, [botLevel, practice]);

  const retryStart = useCallback(() => begin(stateRef.current.category, inviteRef.current), [begin]);

  return { begin, retryStart };
}
