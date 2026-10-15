import { useEffect, useState } from 'react';
import type { CategoryId } from '@clutch/shared';
import { fetchSoloLeaderboard } from './api';
import type { RunStandingState } from './soloResult';

/**
 * Место только что сохранённого забега в таблице дня своей категории. Запрос идёт, когда `enabled`
 * (забег сохранён и дошёл до 100%). Ошибка сети — 'error': экран покажет «—», а не сломается.
 */
export function useRunStanding(category: CategoryId, enabled: boolean): RunStandingState {
  const [state, setState] = useState<RunStandingState>({ status: 'loading' });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState({ status: 'loading' });
    fetchSoloLeaderboard(category, controller.signal)
      .then((board) => { if (!controller.signal.aborted) setState({ status: 'ready', standing: board.you }); })
      .catch(() => { if (!controller.signal.aborted) setState({ status: 'error' }); });
    return () => controller.abort();
  }, [category, enabled]);

  return state;
}
