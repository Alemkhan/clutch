import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { SoloMode } from '@clutch/shared';
import type { MatchRequestCoordinator } from './matchmaking';
import type { SoloFlowState } from './soloRunFlow';
import type { SyncIssue } from './soloSyncIssue';

/** Общие ссылки и сеттеры useSoloRun, которые делят его части (старт, восстановление, отправка кругов). */
export interface SoloRunContext {
  setState: Dispatch<SetStateAction<SoloFlowState>>;
  setSyncIssue: Dispatch<SetStateAction<SyncIssue | null>>;
  coordinatorRef: MutableRefObject<MatchRequestCoordinator>;
  /** Реванш: тот же invite повторяется при «Повторить» и сбрасывается при выходе к категориям. */
  inviteRef: MutableRefObject<string | undefined>;
  stateRef: MutableRefObject<SoloFlowState>;
  practice: boolean;
  /** Режим, в котором открыт экран: забег дня, свободная игра или дуэль. */
  mode: SoloMode;
}
