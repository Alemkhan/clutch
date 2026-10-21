import { useCallback, useEffect, useState } from 'react';
import type { WikiPathTodayResponse } from '@clutch/shared';
import { fetchWikiPathToday } from '../../platform/api';

export type WikiPathTodayState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'absent' }
  | { status: 'available'; today: WikiPathTodayResponse }
  | { status: 'in_progress'; today: WikiPathTodayResponse }
  | { status: 'completed'; today: WikiPathTodayResponse };

function toState(today: WikiPathTodayResponse): WikiPathTodayState {
  if (!today.challenge) return { status: 'absent' };
  if (today.run?.status === 'completed') return { status: 'completed', today };
  if (today.run?.status === 'in_progress') return { status: 'in_progress', today };
  return { status: 'available', today };
}

export function useWikiPathToday(): { state: WikiPathTodayState; reload: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<WikiPathTodayState>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    fetchWikiPathToday(controller.signal)
      .then((today) => { if (!controller.signal.aborted) setState(toState(today)); })
      .catch(() => { if (!controller.signal.aborted) setState({ status: 'error' }); });
    return () => controller.abort();
  }, [attempt]);
  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  return { state, reload };
}
