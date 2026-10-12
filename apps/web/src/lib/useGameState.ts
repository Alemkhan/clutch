import { useState, useCallback } from 'react';
import type { Phase } from './gameSession';

/** Навигация верхнего уровня; игровое состояние живёт внутри экранов (соло — useSoloRun). */
export function useGameState() {
  const [phase, setPhase] = useState<Phase>('home');

  const goToTraining = useCallback(() => setPhase('training'), []);
  const goToLastStand = useCallback(() => setPhase('lastStand'), []);
  const goToSolo = useCallback(() => setPhase('solo'), []);
  const goToMyRuns = useCallback(() => setPhase('myRuns'), []);
  const goToProfile = useCallback(() => setPhase('profile'), []);
  const goHome = useCallback(() => setPhase('home'), []);

  return {
    phase,
    goToProfile,
    goToTraining,
    goToLastStand,
    goToSolo,
    goToMyRuns,
    goHome,
  };
}
