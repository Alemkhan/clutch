import { useEffect, useRef } from 'react';
import type { Phase } from './gameSession';
import type { MatchSource } from './matchmaking';
import { whenTelegramCoreReady } from './telegram';
import {
  telegramBackAction,
  telegramBackButtonAdapter,
  TelegramBackButtonController,
  type TelegramBackAction,
} from './telegramBackButton';

interface BackCallbacks {
  home: () => void;
  categories: () => void;
}

export function useTelegramBackButton(
  phase: Phase,
  matchSource: MatchSource,
  callbacks: BackCallbacks,
): void {
  const action = telegramBackAction(phase, matchSource);
  const actionRef = useRef(action);
  const callbacksRef = useRef(callbacks);
  const controllerRef = useRef<TelegramBackButtonController | null>(null);
  actionRef.current = action;
  callbacksRef.current = callbacks;

  useEffect(() => {
    let active = true;
    void whenTelegramCoreReady().then(() => {
      if (!active) return;
      const controller = new TelegramBackButtonController(
        telegramBackButtonAdapter,
        (next: Exclude<TelegramBackAction, 'hidden'>) => callbacksRef.current[next](),
      );
      controller.setAction(actionRef.current);
      controller.mount();
      controllerRef.current = controller;
    }).catch(() => {});

    return () => {
      active = false;
      controllerRef.current?.dispose();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    controllerRef.current?.setAction(action);
  }, [action]);
}
