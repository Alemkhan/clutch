import { useCallback, useEffect, useState } from 'react';
import type { TiebreakerTodayResponse } from '@clutch/shared';
import { fetchTiebreakerToday } from './api';

export type TiebreakerTodayState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; today: TiebreakerTodayResponse };

/** Чтение вопроса дня: состояние живёт только в экране, между аккаунтами и сессиями ничего не кэшируется. */
export function useTiebreakerToday(): {
  state: TiebreakerTodayState;
  reload: () => void;
  setToday: (today: TiebreakerTodayResponse) => void;
} {
  const [state, setState] = useState<TiebreakerTodayState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    fetchTiebreakerToday(controller.signal)
      .then((today) => { if (!controller.signal.aborted) setState({ status: 'ready', today }); })
      .catch(() => { if (!controller.signal.aborted) setState({ status: 'error' }); });
    return () => controller.abort();
  }, [attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  const setToday = useCallback((today: TiebreakerTodayResponse) => setState({ status: 'ready', today }), []);
  return { state, reload, setToday };
}
