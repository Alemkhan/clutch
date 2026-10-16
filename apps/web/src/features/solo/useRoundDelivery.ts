import { useEffect } from 'react';
import { ApiError, answerSoloRound, hammerSoloRound } from '../../platform/api';
import {
  applySoloAnswerVerdict,
  applySoloHammerVerdict,
  failSoloSync,
  type SoloFlowState,
} from './soloRunFlow';
import { deliverRound } from './soloRoundDelivery';
import { parseSoloRound } from './soloResultModel';
import { CONFLICT_ISSUE, INVALID_RESPONSE_ISSUE, deliveryFailureIssue } from './soloSyncIssue';
import type { SoloRunContext } from './soloRunContext';

/**
 * Отправка круга. Пока сервер не подтвердил, запрос висит в state.pending; повторы автоматические,
 * потом остаётся кнопка. Дубликат сервер не считает, так что лишний запрос ничего не ломает.
 */
export function useRoundDelivery(
  state: SoloFlowState,
  ctx: Pick<SoloRunContext, 'setState' | 'setSyncIssue'>,
  restoreFromServer: (runId: string, onFailure: () => void) => void,
) {
  const { setState, setSyncIssue } = ctx;
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
          setSyncIssue(INVALID_RESPONSE_ISSUE);
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
          setSyncIssue(CONFLICT_ISSUE);
          setState((previous) => failSoloSync(previous, 'conflict'));
        });
        return;
      }
      const failure = deliveryFailureIssue(outcome.transient);
      setSyncIssue(failure.issue);
      setState((previous) => failSoloSync(previous, failure.reason));
    })();
    return () => controller.abort();
  }, [pending, runId, syncFailed, restoreFromServer]);
}
