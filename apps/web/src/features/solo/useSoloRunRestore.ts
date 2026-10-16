import { useCallback } from 'react';
import type { CategoryId } from '@clutch/shared';
import { fetchSoloRunSnapshot, isTransientApiError } from '../../platform/api';
import { normalizeSoloSnapshot } from './clientMatchRules';
import { beginSoloLoading, createSoloFlowState, restoreSoloRun } from './soloRunFlow';
import type { SoloRunContext } from './soloRunContext';
import { clearActiveSoloRun, loadActiveSoloRun } from './soloRunStore';

/** Подтягивание забега с сервера: продолжение после закрытой вкладки и возврат к категориям. */
export function useSoloRunRestore(ctx: SoloRunContext, begin: (category: CategoryId) => void) {
  const { coordinatorRef, inviteRef, stateRef, setState, setSyncIssue, practice } = ctx;

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
  const resume = useCallback((fallbackCategory?: CategoryId) => {
    if (stateRef.current.stage !== 'categories') return;
    const stored = loadActiveSoloRun();
    if (!stored || stored.practice !== practice) {
      // Нечего продолжать: «Играть» с главной начинает забег в категории по умолчанию.
      if (fallbackCategory) begin(fallbackCategory);
      return;
    }
    setState(beginSoloLoading(stateRef.current.category));
    restoreFromServer(stored.runId, () => setState(createSoloFlowState()));
  }, [practice, begin, restoreFromServer]);

  /** Назад с загрузки, ошибки или готового забега: отменяем запрос и возвращаемся к выбору категории. */
  const backToCategories = useCallback(() => {
    inviteRef.current = undefined;
    coordinatorRef.current.cancel();
    clearActiveSoloRun();
    setSyncIssue(null);
    setState(createSoloFlowState());
  }, []);

  return { restoreFromServer, resume, backToCategories };
}
