import { useState, useCallback, useEffect, useRef } from 'react';
import { analytics } from './analytics';
import type {
  SkillResult,
  Question,
  Opponent,
  Tournament,
  CategoryId,
} from '@clutch/shared';
import {
  CURRENT_ASYNC_MATCH_CONDITIONS,
} from '@clutch/shared';
import { createQuestions, createSampleOpponent } from './sampleData';
import { startAsyncMatch } from './api';
import { completionQueue, type CompletionQueueEvent } from './completionQueue';
import {
  normalizeOnlineMatch,
  normalizeScriptedOpponent,
  validateMiniGameConfig,
} from './clientMatchRules';
import {
  completeSkillDistance,
  continueAfterAnswerResolution,
  createChallengeLobbyState,
  createChallengeReplayState,
  createInitialGameState,
  createPreparedMatchState,
  recordAnswer,
} from './gameSession';

export type ResultSaveStatus = 'practice' | 'pending' | 'saved' | 'error';

export function useGameState() {
  const [state, setState] = useState(createInitialGameState);
  const [resultSave, setResultSave] = useState<{
    status: ResultSaveStatus;
    error?: string;
    canRetry: boolean;
  }>({
    status: 'practice',
    canRetry: false,
  });
  const activeMatchIdRef = useRef<string>();
  const reportedCompletionRef = useRef<string>();
  const reportedSavePendingRef = useRef<string>();
  activeMatchIdRef.current = state.activeMatchId;

  const start = useCallback(async () => {
    analytics.startMatch();
    if (state.fixedQuestions) {
      analytics.track('match_started', { source: 'challenge' });
      setState(createChallengeReplayState);
      return;
    }

    let rawMatch;
    try {
      rawMatch = await startAsyncMatch(state.category);
    } catch {
      const questions = createQuestions(state.category);
      const opponent = createSampleOpponent(questions);
      analytics.track('match_started', { source: 'local_fallback' });
      setState((prev) => createPreparedMatchState({ category: prev.category, opponent, questions }));
      return;
    }

    try {
      const match = normalizeOnlineMatch(rawMatch);
      analytics.track('match_started', { source: match.opponentSource });
      setState((prev) => createPreparedMatchState({
        category: prev.category,
        opponent: match.opponent,
        questions: match.questions,
        activeMatchId: match.matchId,
        miniGameConfig: match.config,
      }));
    } catch (error) {
      console.error('Invalid async match response:', error);
      setState((prev) => ({ ...createInitialGameState(), category: prev.category, phase: 'categories' }));
    }
  }, [state.category, state.fixedQuestions]);

  const startChallenge = useCallback((tournament: Tournament, opponent: Opponent, fixedQuestions?: Question[]) => {
    if (!fixedQuestions) throw new Error('Challenge questions are required.');
    if (tournament.miniGame.id !== CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.id) {
      throw new Error('Challenge mini-game is not supported.');
    }
    const normalizedOpponent = normalizeScriptedOpponent(opponent, fixedQuestions);
    const config = validateMiniGameConfig(tournament.miniGame.config);
    setState(createChallengeLobbyState({
      questions: fixedQuestions,
      opponent: normalizedOpponent,
      activeVideo: tournament.video,
      miniGameConfig: config,
    }));
  }, []);

  useEffect(() => {
    if (state.phase !== 'result' || state.questions.length === 0) return;
    const completionId = state.activeMatchId ?? analytics.matchId;
    if (!completionId || reportedCompletionRef.current === completionId) return;
    reportedCompletionRef.current = completionId;
    analytics.track('match_completed', {
      playerProgress: state.rulesState.playerProgress,
      opponentProgress: state.rulesState.opponentProgress,
    });
  }, [
    state.phase,
    state.questions.length,
    state.activeMatchId,
    state.rulesState.playerProgress,
    state.rulesState.opponentProgress,
  ]);

  useEffect(() => {
    const handleQueueEvent = (event: CompletionQueueEvent) => {
      if (event.entry.matchId !== activeMatchIdRef.current) return;
      if (event.type === 'confirmed') {
        setResultSave({ status: 'saved', canRetry: false });
        setState((previous) => previous.activeMatchId === event.entry.matchId
          ? {
              ...previous,
              correctCount: event.response.correctCount,
              rulesState: {
                ...previous.rulesState,
                roundsPlayed: event.response.rounds.length,
                playerProgress: event.response.playerProgress,
                outcome: event.response.playerProgress === previous.rulesState.opponentProgress
                  ? 'tie'
                  : event.response.playerProgress > previous.rulesState.opponentProgress
                    ? 'player'
                    : 'opponent',
              },
            }
          : previous);
        return;
      }
      if (event.entry.status === 'error') {
        setResultSave({
          status: 'error',
          error: 'Не удалось подтвердить результат.',
          canRetry: event.entry.canRetry,
        });
      } else {
        setResultSave({ status: 'pending', canRetry: false });
      }
    };
    return completionQueue.subscribe(handleQueueEvent);
  }, []);

  useEffect(() => {
    if (state.phase !== 'result' || !state.activeMatchId) {
      setResultSave({ status: 'practice', canRetry: false });
      return;
    }
    try {
      const entry = completionQueue.enqueue(
        state.activeMatchId,
        { rounds: state.roundInputs },
        state.rulesState.opponentProgress,
      );
      setResultSave(entry.status === 'error'
        ? {
            status: 'error',
            error: 'Не удалось подтвердить результат.',
            canRetry: entry.canRetry,
          }
        : { status: 'pending', canRetry: false });
      if (reportedSavePendingRef.current !== state.activeMatchId) {
        reportedSavePendingRef.current = state.activeMatchId;
        analytics.track('match_save_pending', { matchId: state.activeMatchId });
      }
      void completionQueue.flush();
    } catch {
      setResultSave({
        status: 'error',
        error: 'Очередь сохранения заполнена. Попробуйте позже.',
        canRetry: false,
      });
      if (reportedSavePendingRef.current !== state.activeMatchId) {
        reportedSavePendingRef.current = state.activeMatchId;
        analytics.track('match_save_failed', { matchId: state.activeMatchId });
      }
    }
  }, [state.phase, state.activeMatchId, state.roundInputs, state.rulesState.opponentProgress]);

  const retryResultSave = useCallback(() => {
    if (state.activeMatchId) completionQueue.retry(state.activeMatchId);
  }, [state.activeMatchId]);

  const answer = useCallback((optionId: string, _timeMs: number) => {
    setState((prev) => {
      const question = prev.questions[prev.questionIndex];
      const next = recordAnswer(prev, optionId, _timeMs);
      analytics.track('answer_submitted', {
        questionId: question?.id,
        questionIndex: prev.questionIndex,
        category: question?.category,
        difficulty: question?.difficulty,
        answerType: question?.answerType,
        selectedOption: optionId,
        correctness: next.lastCorrect,
        responseTimeMs: _timeMs,
      });
      return next;
    });
  }, []);

  const continueAfterResolution = useCallback(() => {
    setState(continueAfterAnswerResolution);
  }, []);

  const completeHammer = useCallback((_result: SkillResult, _progress: number, distance: number) => {
    setState((prev) => completeSkillDistance(prev, distance));
  }, []);

  const reset = useCallback(() => {
    setState(createInitialGameState());
  }, []);

  const goToCategories = useCallback(() => {
    setState({ ...createInitialGameState(), phase: 'categories' });
  }, []);

  const goToMatchmaking = useCallback((category?: string) => {
    setState((prev) => ({
      ...prev,
      category: (category === 'history' || category === 'languages' ? category : 'geography') as CategoryId,
      phase: 'matchmaking',
    }));
  }, []);

  const goToProfile = useCallback(() => {
    setState((prev) => ({ ...prev, phase: 'profile' }));
  }, []);

  const goHome = useCallback(() => {
    setState((prev) => ({ ...prev, phase: 'home' }));
  }, []);

  return {
    phase: state.phase,
    questionIndex: state.questionIndex,
    playerProgress: state.rulesState.playerProgress,
    opponentProgress: state.rulesState.opponentProgress,
    lastCorrect: state.lastCorrect,
    lastSkill: state.lastSkill,
    bestSkill: state.bestSkill,
    correctCount: state.correctCount,
    selectedOption: state.selectedOption,
    responseTimes: state.responseTimes,
    skillResults: state.skillResults,
    perfectHits: state.skillResults.filter((r) => r === 'perfect').length,
    avgResponseMs: state.responseTimes.length
      ? Math.round(state.responseTimes.reduce((a, b) => a + b, 0) / state.responseTimes.length)
      : 0,
    totalQuestions: state.questions.length,
    questionsPlayed: state.rulesState.roundsPlayed,
    currentQuestion: state.questions[state.questionIndex],
    opponent: state.opponent,
    activeVideo: state.activeVideo,
    miniGameConfig: state.miniGameConfig,
    resultSaveStatus: resultSave.status,
    resultSaveError: resultSave.error,
    canRetryResultSave: resultSave.canRetry,
    retryResultSave,
    start,
    startChallenge,
    answer,
    continueAfterResolution,
    completeHammer,
    reset,
    goToCategories,
    goToMatchmaking,
    goToProfile,
    goHome,
  };
}
