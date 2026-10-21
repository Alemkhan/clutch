import { useState, useCallback } from 'react';
import type { Phase } from './gameSession';

/** Навигация верхнего уровня; игровое состояние живёт внутри экранов (соло — useSoloRun). */
export function useGameState() {
  const [phase, setPhase] = useState<Phase>('home');

  const goToTraining = useCallback(() => setPhase('training'), []);
  const goToSolo = useCallback(() => setPhase('solo'), []);
  const goToMyRuns = useCallback(() => setPhase('myRuns'), []);
  const goToProfile = useCallback(() => setPhase('profile'), []);
  const goToBoard = useCallback(() => setPhase('board'), []);
  const goToTiebreaker = useCallback(() => setPhase('tiebreaker'), []);
  const goToWikiPath = useCallback(() => setPhase('wikiPath'), []);
  const goHome = useCallback(() => setPhase('home'), []);

  return {
    phase,
    goToProfile,
    goToTraining,
    goToSolo,
    goToMyRuns,
    goToBoard,
    goToTiebreaker,
    goToWikiPath,
    goHome,
  };
}
