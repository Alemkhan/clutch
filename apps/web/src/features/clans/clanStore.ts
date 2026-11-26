import { useEffect, useSyncExternalStore } from 'react';
import type { ClanMeResponse } from '@clutch/shared';
import { fetchMyClan } from '../../platform/api';
import { clansEnabled } from './clansEnabled';

/**
 * Свой клан на всё приложение: эмодзи - аватар игрока на табло, в таблицах и в профиле, поэтому
 * он нужен многим экранам сразу. Грузится один раз; вступление и основание кладут свежий ответ.
 */
export type MyClanState =
  | { status: 'idle' | 'loading' | 'error'; me: null }
  | { status: 'ready'; me: ClanMeResponse };

let state: MyClanState = { status: 'idle', me: null };
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: MyClanState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function setMyClan(me: ClanMeResponse): void {
  emit({ status: 'ready', me });
}

export function loadMyClan(force = false): Promise<void> {
  if (inFlight) return inFlight;
  if (!force && state.status === 'ready') return Promise.resolve();
  // До запуска кланов сервер не спрашиваем: клана нет и занять нельзя.
  if (!clansEnabled()) {
    setMyClan({ clan: null, canFound: false });
    return Promise.resolve();
  }
  if (state.status !== 'ready') emit({ status: 'loading', me: null });
  inFlight = fetchMyClan().then(
    (me) => setMyClan(me),
    () => { if (state.status !== 'ready') emit({ status: 'error', me: null }); },
  ).finally(() => { inFlight = null; });
  return inFlight;
}

/** Эмодзи своего клана или null (нет клана или ещё не загрузился). */
export function myClanEmoji(): string | null {
  return state.me?.clan?.emoji ?? null;
}

export function useMyClan(): MyClanState {
  const current = useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => state,
    () => state,
  );
  useEffect(() => {
    if (state.status === 'idle') void loadMyClan();
  }, []);
  return current;
}

/** Для тестов: забыть загруженный клан. */
export function resetMyClanForTests(): void {
  inFlight = null;
  emit({ status: 'idle', me: null });
}
